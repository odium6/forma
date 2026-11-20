/**
 * PIN handling via the Web Crypto API (PBKDF2-SHA-256, random salt).
 * The PIN is never stored; only the derived hash. This gates access in the UI —
 * it does not encrypt IndexedDB, and the app says so to the user.
 */

const ITERATIONS = 310_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return { hash: await derive(pin, salt, ITERATIONS), salt: toHex(salt), iterations: ITERATIONS };
}

export async function verifyPin(pin: string, stored: { hash: string; salt: string; iterations: number }): Promise<boolean> {
  const h = await derive(pin, fromHex(stored.salt), stored.iterations);
  // constant-time comparison
  if (h.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

/** Simple escalating lockout after wrong attempts, kept in sessionStorage. */
export function lockoutRemainingMs(): number {
  try {
    const until = Number(sessionStorage.getItem('forma-lock-until') ?? 0);
    return Math.max(0, until - Date.now());
  } catch {
    return 0;
  }
}

export function registerFailedAttempt(): number {
  try {
    const n = Number(sessionStorage.getItem('forma-fails') ?? 0) + 1;
    sessionStorage.setItem('forma-fails', String(n));
    if (n >= 5) {
      const wait = Math.min(300_000, 15_000 * 2 ** (n - 5));
      sessionStorage.setItem('forma-lock-until', String(Date.now() + wait));
      return wait;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export function resetAttempts() {
  try {
    sessionStorage.removeItem('forma-fails');
    sessionStorage.removeItem('forma-lock-until');
  } catch {
    /* ignore */
  }
}

// ── platform biometrics via WebAuthn ──────────────────────────────────────────

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/**
 * Registers a device-bound platform credential (Face ID / Touch ID / Windows Hello).
 * Without a server we cannot verify signatures; a successful user-verified assertion for
 * our credential id is used as a local unlock gesture, alongside the PIN.
 */
export async function registerBiometric(): Promise<string | null> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'FORMA', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'forma-local', displayName: 'FORMA' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  return cred ? b64url(cred.rawId) : null;
}

export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const res = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    const flags = res ? new Uint8Array((res.response as AuthenticatorAssertionResponse).authenticatorData)[32] : 0;
    // bit 2 = user verified
    return !!res && b64url(res.rawId) === credentialId && (flags & 0x04) !== 0;
  } catch {
    return false;
  }
}
