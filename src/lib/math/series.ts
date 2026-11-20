import type { Entry, ISODate, MeasurementKey } from '@/domain/types';
import { dayNumber } from '@/lib/dates';

/** One value per calendar day. Days without measurements are absent — never interpolated. */
export interface Point {
  date: ISODate;
  day: number;
  value: number;
}

export type SeriesKey = 'weight' | 'bodyFat' | MeasurementKey;

export function entryValue(e: Entry, key: SeriesKey): number | null {
  if (key === 'weight') return e.weight;
  if (key === 'bodyFat') return e.bodyFat;
  const v = e.measurements[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Aggregates raw entries into a daily series (mean of that day's values).
 * Several weigh-ins on one day are averaged so a single day never gets extra weight in trends.
 */
export function dailySeries(entries: Entry[], key: SeriesKey): Point[] {
  const byDay = new Map<ISODate, { sum: number; n: number }>();
  for (const e of entries) {
    const v = entryValue(e, key);
    if (v == null) continue;
    const acc = byDay.get(e.date) ?? { sum: 0, n: 0 };
    acc.sum += v;
    acc.n += 1;
    byDay.set(e.date, acc);
  }
  return [...byDay.entries()]
    .map(([date, { sum, n }]) => ({ date, day: dayNumber(date), value: sum / n }))
    .sort((a, b) => a.day - b.day);
}

export function pointsBetween(points: Point[], from: ISODate | null, to: ISODate | null): Point[] {
  const a = from ? dayNumber(from) : -Infinity;
  const b = to ? dayNumber(to) : Infinity;
  return points.filter((p) => p.day >= a && p.day <= b);
}

/**
 * Trailing moving average over `windowDays` calendar days, evaluated only on days that
 * have a measurement. A value is produced only when the window holds ≥ `minPoints` values.
 */
export function movingAverage(points: Point[], windowDays = 7, minPoints = 3): (number | null)[] {
  const out: (number | null)[] = [];
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].value;
    while (points[lo].day <= points[i].day - windowDays) {
      sum -= points[lo].value;
      lo++;
    }
    const n = i - lo + 1;
    out.push(n >= minPoints ? sum / n : null);
  }
  return out;
}

/**
 * Time-aware exponential smoothing ("trend weight"). With daily smoothing factor α,
 * a gap of Δ days uses α_eff = 1 − (1 − α)^Δ, so sparse logging does not distort the trend.
 */
export function exponentialTrend(points: Point[], alpha = 0.1): number[] {
  const out: number[] = [];
  let prev: Point | null = null;
  let t = 0;
  for (const p of points) {
    if (!prev) t = p.value;
    else {
      const gap = Math.max(1, p.day - prev.day);
      const a = 1 - (1 - alpha) ** gap;
      t = t + a * (p.value - t);
    }
    out.push(t);
    prev = p;
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface LinearFit {
  /** Change per day. */
  slope: number;
  /** Fitted value at `refDay`. */
  level: number;
  refDay: number;
  /** Standard error of the slope. */
  slopeSE: number;
  residualSD: number;
  r2: number;
  n: number;
  spanDays: number;
  outliersRemoved: number;
}

function ols(points: Point[], refDay: number): Omit<LinearFit, 'outliersRemoved'> | null {
  const n = points.length;
  if (n < 2) return null;
  const xs = points.map((p) => p.day - refDay);
  const ys = points.map((p) => p.value);
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx; // value at x = 0, i.e. refDay
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const residualSD = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const slopeSE = n > 2 ? residualSD / Math.sqrt(sxx) : Infinity;
  return {
    slope,
    level: intercept,
    refDay,
    slopeSE,
    residualSD,
    r2: syy === 0 ? 1 : 1 - sse / syy,
    n,
    spanDays: points[n - 1].day - points[0].day,
  };
}

/**
 * Robust linear trend over the last `windowDays` ending at `endDate`.
 * Ordinary least squares, then one pass that drops points further than 3 robust σ
 * (MAD-based) from the fit — a single unusual weigh-in can't swing the trend.
 */
export function linearTrend(
  points: Point[],
  endDate: ISODate,
  windowDays: number,
  opts: { minPoints?: number; minSpanDays?: number } = {},
): LinearFit | null {
  const { minPoints = 4, minSpanDays = Math.min(6, windowDays - 1) } = opts;
  const end = dayNumber(endDate);
  const win = points.filter((p) => p.day > end - windowDays && p.day <= end);
  if (win.length < minPoints) return null;
  if (win[win.length - 1].day - win[0].day < minSpanDays) return null;
  const first = ols(win, end);
  if (!first) return null;
  const resid = win.map((p) => p.value - (first.level + first.slope * (p.day - end)));
  const mad = median(resid.map((r) => Math.abs(r - median(resid))));
  const sigma = Math.max(mad * 1.4826, 0.15);
  const kept = win.filter((_, i) => Math.abs(resid[i]) <= 3 * sigma);
  if (kept.length === win.length || kept.length < minPoints) return { ...first, outliersRemoved: 0 };
  const second = ols(kept, end);
  return second ? { ...second, outliersRemoved: win.length - kept.length } : { ...first, outliersRemoved: 0 };
}

/** Last point at or before `date`, if it is not older than `maxAgeDays`. */
export function valueAtOrBefore(points: Point[], values: number[], date: ISODate, maxAgeDays: number): number | null {
  const d = dayNumber(date);
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].day <= d) return d - points[i].day <= maxAgeDays ? values[i] : null;
  }
  return null;
}

/**
 * Change of the smoothed trend over the last `days`. Needs data near both ends,
 * otherwise returns null ("not enough data") instead of a misleading number.
 */
export function trendChange(points: Point[], endDate: ISODate, days: number): number | null {
  if (points.length < 3) return null;
  const trend = exponentialTrend(points);
  const tolerance = Math.max(2, Math.round(days / 4));
  const now = valueAtOrBefore(points, trend, endDate, tolerance);
  const startDay = dayNumber(endDate) - days;
  const startIdx = points.findIndex((p) => p.day >= startDay - tolerance);
  if (now == null || startIdx < 0 || points[startIdx].day > startDay + tolerance) return null;
  // need at least 3 points in the period so the start estimate is not a single reading
  const inPeriod = points.filter((p) => p.day >= startDay - tolerance && p.day <= dayNumber(endDate)).length;
  if (inPeriod < 3) return null;
  return now - trend[startIdx];
}

/** Mean of the last 7 calendar days compared with the 7 days before. Each week needs ≥ 3 values. */
export function weeklyAverageChange(points: Point[], endDate: ISODate): { current: number; previous: number; delta: number } | null {
  const end = dayNumber(endDate);
  const cur = points.filter((p) => p.day > end - 7 && p.day <= end).map((p) => p.value);
  const prev = points.filter((p) => p.day > end - 14 && p.day <= end - 7).map((p) => p.value);
  if (cur.length < 3 || prev.length < 3) return null;
  const c = mean(cur);
  const p = mean(prev);
  return { current: c, previous: p, delta: c - p };
}
