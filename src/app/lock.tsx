import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useData } from '@/state/store';
import { isValidPin, lockoutRemainingMs, registerFailedAttempt, resetAttempts, verifyBiometric, verifyPin } from '@/lib/security';
import { Icon } from '@/ui/Icon';
import { LogoMark } from '@/ui/Logo';
import './lock.css';

interface LockApi {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
  hasPin: boolean;
}

const Ctx = createContext<LockApi>({ locked: false, lock: () => {}, unlock: () => {}, hasPin: false });

/**
 * Session lock. When a PIN exists the protected scope starts locked and re-locks
 * after the configured inactivity or when the app was in the background that long.
 */
export function LockProvider({ children }: { children: ReactNode }) {
  const { settings } = useData();
  const hasPin = !!settings.pin;
  const [locked, setLocked] = useState(hasPin);
  const lastActive = useRef(Date.now());
  const timeoutMs = settings.autoLockMinutes * 60_000;

  useEffect(() => {
    if (!hasPin) setLocked(false);
  }, [hasPin]);

  useEffect(() => {
    if (!hasPin) return;
    const touch = () => {
      lastActive.current = Date.now();
    };
    // timeoutMs === 0 means "immediately": lock as soon as the app leaves the screen
    const check = () => {
      if (timeoutMs > 0 && Date.now() - lastActive.current > timeoutMs) setLocked(true);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
      else if (timeoutMs === 0) setLocked(true);
      else touch();
    };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(check, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(t);
    };
  }, [hasPin, timeoutMs]);

  const lock = useCallback(() => hasPin && setLocked(true), [hasPin]);
  const unlock = useCallback(() => {
    lastActive.current = Date.now();
    setLocked(false);
  }, []);

  return <Ctx.Provider value={{ locked: hasPin && locked, lock, unlock, hasPin }}>{children}</Ctx.Provider>;
}

export function useLock() {
  return useContext(Ctx);
}

export function LockScreen({ scope }: { scope: 'app' | 'photos' }) {
  const { settings } = useData();
  const { unlock } = useLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triedBio = useRef(false);

  const tryBio = useCallback(async () => {
    if (!settings.biometricCredentialId) return;
    if (await verifyBiometric(settings.biometricCredentialId)) {
      resetAttempts();
      unlock();
    }
  }, [settings.biometricCredentialId, unlock]);

  useEffect(() => {
    if (!triedBio.current && settings.biometricCredentialId) {
      triedBio.current = true;
      void tryBio();
    }
  }, [settings.biometricCredentialId, tryBio]);

  const submit = async (value: string) => {
    if (!settings.pin || busy) return;
    const wait = lockoutRemainingMs();
    if (wait > 0) {
      setError(`Слишком много попыток. Подожди ${Math.ceil(wait / 1000)} с.`);
      return;
    }
    setBusy(true);
    const ok = await verifyPin(value, settings.pin);
    setBusy(false);
    if (ok) {
      resetAttempts();
      unlock();
    } else {
      const w = registerFailedAttempt();
      setPin('');
      setError(w ? `Неверный PIN. Повтор через ${Math.ceil(w / 1000)} с.` : 'Неверный PIN');
    }
  };

  const press = (d: string) => {
    setError(null);
    const next = (pin + d).slice(0, 8);
    setPin(next);
    if (next.length >= 4 && settings.pin && isValidPin(next) && next.length === pinLengthHint()) void submit(next);
  };

  return (
    <div className={`lock lock-${scope}`} role="dialog" aria-modal="true" aria-label="Разблокировка FORMA">
      <div className="lock-inner">
        <LogoMark size={56} />
        <h2>{scope === 'app' ? 'FORMA заблокирована' : 'Фото защищены'}</h2>
        <p className="muted small">Введи PIN-код{settings.biometricCredentialId ? ' или используй биометрию' : ''}</p>
        <div className="pin-dots" aria-hidden="true">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        <input
          className="sr-only"
          aria-label="PIN-код"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          data-testid="pin-input"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          onKeyDown={(e) => e.key === 'Enter' && submit(pin)}
        />
        <div className="lock-error" role="alert">{error}</div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => press(d)}>{d}</button>
          ))}
          {settings.biometricCredentialId ? (
            <button type="button" onClick={tryBio} aria-label="Биометрия"><Icon name="fingerprint" size={26} /></button>
          ) : <span />}
          <button type="button" onClick={() => press('0')}>0</button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Стереть"><Icon name="left" size={24} /></button>
        </div>
        <button className="btn primary block" disabled={pin.length < 4 || busy} onClick={() => submit(pin)} data-testid="pin-submit">
          Разблокировать
        </button>
      </div>
    </div>
  );

  function pinLengthHint(): number {
    try {
      return Number(localStorage.getItem('forma-pin-len') ?? 0);
    } catch {
      return 0;
    }
  }
}
