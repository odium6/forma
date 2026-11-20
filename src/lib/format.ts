/** Russian number/word formatting helpers. */

export function fmtNum(v: number, digits = 2): string {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtKg(v: number, digits = 2): string {
  return `${fmtNum(v, digits)} кг`;
}

export function fmtSigned(v: number, digits = 2, unit = ''): string {
  const rounded = Number(v.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${fmtNum(Math.abs(rounded), digits)}${unit ? ` ${unit}` : ''}`;
}

export function fmtPct(v: number, digits = 0): string {
  return `${fmtNum(v * 100, digits)}%`;
}

/** plural(5, ['день','дня','дней']) → 'дней' */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function nDays(n: number): string {
  return `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

export function nWeeks(n: number): string {
  return `${n} ${plural(n, ['неделя', 'недели', 'недель'])}`;
}

/** Parses user input like "72,4" or "72.4"; returns null when not a finite number. */
export function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/\s/g, '');
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
