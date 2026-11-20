import type { ISODate } from '@/domain/types';
import { addDays, dayNumber } from '@/lib/dates';
import { linearTrend, type LinearFit, type Point } from './series';

export const FORECAST_RULES = {
  windowDays: 28,
  minPoints: 6,
  minSpanDays: 10,
  /** Below this weekly change the trend counts as flat. */
  flatKgPerWeek: 0.05,
  /** Forecasts further away than this are not shown as a date. */
  maxHorizonDays: 3 * 365,
  /** Extra relative uncertainty: future pace rarely stays constant. */
  paceDriftPct: 0.2,
  /** z for an ≈80 % interval. */
  z: 1.28,
} as const;

export type ForecastStatus =
  | 'insufficient' // too few or too clustered measurements
  | 'reached' // trend already at target
  | 'flat' // no meaningful movement
  | 'away' // trend moves away from target
  | 'too_far' // beyond horizon
  | 'ok';

export type Confidence = 'low' | 'medium' | 'high';

export interface Forecast {
  status: ForecastStatus;
  /** Smoothed current level at the last measurement (from the regression). */
  level: number | null;
  kgPerWeek: number | null;
  date: ISODate | null;
  /** Interval of plausible dates; `late` is null when the slow edge never reaches the target. */
  early: ISODate | null;
  late: ISODate | null;
  daysLeft: number | null;
  confidence: Confidence | null;
  fit: LinearFit | null;
  /** What is needed to get a forecast when insufficient. */
  needPoints: number;
  needSpanDays: number;
  /** Observed pace as % body weight per week (absolute). */
  pctPerWeek: number | null;
}

function confidenceOf(fit: LinearFit): Confidence {
  const rel = Math.abs(fit.slopeSE / (fit.slope || 1e-9));
  if (fit.n >= 14 && fit.spanDays >= 21 && rel < 0.25) return 'high';
  if (fit.n >= 8 && rel < 0.5) return 'medium';
  return 'low';
}

export function forecastGoal(points: Point[], target: number | null, asOf: ISODate): Forecast {
  const R = FORECAST_RULES;
  const base: Forecast = {
    status: 'insufficient',
    level: null,
    kgPerWeek: null,
    date: null,
    early: null,
    late: null,
    daysLeft: null,
    confidence: null,
    fit: null,
    needPoints: 0,
    needSpanDays: 0,
    pctPerWeek: null,
  };
  const end = points.length ? points[points.length - 1].date : asOf;
  const recent = points.filter((p) => p.day > dayNumber(end) - R.windowDays);
  const span = recent.length ? recent[recent.length - 1].day - recent[0].day : 0;
  const fit = linearTrend(points, end, R.windowDays, { minPoints: R.minPoints, minSpanDays: R.minSpanDays });
  if (!fit) {
    return { ...base, needPoints: Math.max(0, R.minPoints - recent.length), needSpanDays: Math.max(0, R.minSpanDays - span) };
  }
  const kgPerWeek = fit.slope * 7;
  const level = fit.level;
  const out: Forecast = {
    ...base,
    fit,
    level,
    kgPerWeek,
    confidence: confidenceOf(fit),
    pctPerWeek: (Math.abs(kgPerWeek) / level) * 100,
    status: 'ok',
  };
  if (target == null) return { ...out, status: Math.abs(kgPerWeek) < R.flatKgPerWeek ? 'flat' : 'ok' };

  const remaining = target - level;
  if (Math.abs(remaining) <= 0.3) return { ...out, status: 'reached', date: end, daysLeft: 0 };
  if (Math.abs(kgPerWeek) < R.flatKgPerWeek) return { ...out, status: 'flat' };
  if (Math.sign(remaining) !== Math.sign(fit.slope)) return { ...out, status: 'away' };

  const days = remaining / fit.slope;
  // elapsed since the last measurement already counts toward the forecast
  const fromEnd = Math.round(days);
  const asOfOffset = dayNumber(asOf) - dayNumber(end);
  const daysLeft = Math.max(0, fromEnd - Math.max(0, asOfOffset));
  if (fromEnd > R.maxHorizonDays) return { ...out, status: 'too_far' };

  const margin = R.z * fit.slopeSE + Math.abs(fit.slope) * R.paceDriftPct;
  const fast = Math.abs(fit.slope) + margin;
  const slow = Math.abs(fit.slope) - margin;
  const early = addDays(end, Math.round(Math.abs(remaining) / fast));
  const lateDays = slow > 0 ? Math.round(Math.abs(remaining) / slow) : Infinity;
  const late = lateDays <= R.maxHorizonDays ? addDays(end, lateDays) : null;
  return { ...out, date: addDays(end, fromEnd), early, late, daysLeft };
}

/** Points of the projected trajectory, for drawing (from last level toward target). */
export function forecastPath(f: Forecast, target: number | null, maxDays = 365): { day: number; value: number; lo: number; hi: number }[] {
  if (!f.fit || f.level == null) return [];
  const startDay = f.fit.refDay;
  let horizon = maxDays;
  if (target != null && f.status === 'ok' && f.date) horizon = Math.min(maxDays, dayNumber(f.date) - startDay);
  if (f.status === 'reached' || f.status === 'insufficient') return [];
  horizon = Math.max(7, Math.min(horizon, 365));
  const margin = FORECAST_RULES.z * f.fit.slopeSE + Math.abs(f.fit.slope) * FORECAST_RULES.paceDriftPct;
  const steps = Math.min(40, horizon);
  const out: { day: number; value: number; lo: number; hi: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = Math.round((horizon * i) / steps);
    let v = f.level + f.fit.slope * d;
    let lo = v - margin * d - f.fit.residualSD * 0.5;
    let hi = v + margin * d + f.fit.residualSD * 0.5;
    if (target != null) {
      // trajectory stops at the target instead of overshooting it on the chart
      if (f.fit.slope < 0) {
        v = Math.max(v, target);
        lo = Math.max(lo, target - 0.0001);
      } else {
        v = Math.min(v, target);
        hi = Math.min(hi, target + 0.0001);
      }
    }
    out.push({ day: startDay + d, value: v, lo: Math.min(lo, v), hi: Math.max(hi, v) });
  }
  return out;
}

