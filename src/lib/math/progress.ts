/**
 * Direction-aware goal progress.
 * fraction = (current − start) / (target − start), clamped to [0, 1].
 * The raw value is kept so the UI can explain overshoot (> 1) or regress (< 0) explicitly.
 */
export interface GoalProgress {
  fraction: number;
  raw: number;
  state: 'regressed' | 'in_progress' | 'reached';
  doneKg: number;
  leftKg: number;
  totalKg: number;
}

export function goalProgress(start: number, target: number, current: number, reachTolerance = 0.2): GoalProgress | null {
  const total = target - start;
  if (Math.abs(total) < 1e-9) return null;
  const done = current - start;
  const raw = done / total;
  const left = target - current;
  const reached = raw >= 1 || Math.abs(left) <= reachTolerance;
  return {
    fraction: reached ? 1 : Math.min(1, Math.max(0, raw)),
    raw,
    state: reached ? 'reached' : raw < 0 ? 'regressed' : 'in_progress',
    // signed toward the target: positive = moved in the desired direction
    doneKg: Math.sign(total) * done,
    leftKg: Math.max(0, Math.sign(total) * left),
    totalKg: Math.abs(total),
  };
}

export interface MaintenanceStatus {
  low: number;
  high: number;
  deviation: number; // signed distance outside the band, 0 when inside
  state: 'inside' | 'above' | 'below';
}

export function maintenanceStatus(center: number, tolerance: number, current: number): MaintenanceStatus {
  const low = center - tolerance;
  const high = center + tolerance;
  if (current > high) return { low, high, deviation: current - high, state: 'above' };
  if (current < low) return { low, high, deviation: current - low, state: 'below' };
  return { low, high, deviation: 0, state: 'inside' };
}
