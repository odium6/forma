import type { AppData, Entry, ISODate, MeasurementKey } from '@/domain/types';
import { addDays, addMonths, diffDays, today as todayFn } from '@/lib/dates';
import { dailySeries, exponentialTrend, mean, pointsBetween, type Point } from '@/lib/math/series';
import { habitPeriods, indexLogs, streakRuns } from '@/lib/habits';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { MEASUREMENT_LABELS, metricLabel } from '@/lib/metrics';

export type ReportPeriod = 'week' | 'month' | '3m' | '6m' | 'year' | 'custom' | 'goal';

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  week: 'Неделя',
  month: 'Месяц',
  '3m': '3 месяца',
  '6m': '6 месяцев',
  year: 'Год',
  custom: 'Свой период',
  goal: 'Период цели',
};

export function periodRange(p: ReportPeriod, data: AppData, asOf: ISODate = todayFn(), custom?: { from: ISODate; to: ISODate }): { from: ISODate; to: ISODate } {
  switch (p) {
    case 'week':
      return { from: addDays(asOf, -6), to: asOf };
    case 'month':
      return { from: addDays(addMonths(asOf, -1), 1), to: asOf };
    case '3m':
      return { from: addDays(addMonths(asOf, -3), 1), to: asOf };
    case '6m':
      return { from: addDays(addMonths(asOf, -6), 1), to: asOf };
    case 'year':
      return { from: addDays(addMonths(asOf, -12), 1), to: asOf };
    case 'goal': {
      const g = [...data.goals].reverse().find((x) => x.status !== 'archived') ?? data.goals[data.goals.length - 1];
      const end = g?.status === 'achieved' && g.achievedAt ? g.achievedAt : asOf;
      return { from: g?.startDate ?? addDays(asOf, -29), to: end };
    }
    case 'custom':
      return custom && custom.from <= custom.to ? custom : { from: addDays(asOf, -29), to: asOf };
  }
}

export interface MetricSummary {
  key: string;
  label: string;
  unit: string;
  first: Point | null;
  last: Point | null;
  change: number | null;
  count: number;
}

export interface HabitSummary {
  id: string;
  name: string;
  icon: string;
  scheduled: number;
  done: number;
  rate: number | null;
  bestStreakInPeriod: number;
}

export interface Report {
  from: ISODate;
  to: ISODate;
  days: number;
  weight: {
    points: Point[];
    trend: number[];
    start: number | null;
    end: number | null;
    change: number | null;
    trendChange: number | null;
    average: number | null;
    min: Point | null;
    max: Point | null;
    count: number;
    loggedDays: number;
  };
  bodyFat: MetricSummary;
  measurements: MetricSummary[];
  habits: HabitSummary[];
  habitRate: number | null;
  achievements: { id: string; title: string; icon: string; date: ISODate }[];
  photos: { id: string; date: ISODate; category: string }[];
  entries: Entry[];
}

function summarize(data: AppData, key: 'bodyFat' | MeasurementKey, from: ISODate, to: ISODate): MetricSummary {
  const pts = pointsBetween(dailySeries(data.entries, key), from, to);
  const first = pts[0] ?? null;
  const last = pts[pts.length - 1] ?? null;
  const { label, unit } = key === 'bodyFat' ? { label: 'Процент жира', unit: '%' } : metricLabel(key, data.customMetrics);
  return { key, label, unit, first, last, change: first && last && pts.length > 1 ? last.value - first.value : null, count: pts.length };
}

export function buildReport(data: AppData, from: ISODate, to: ISODate): Report {
  const all = dailySeries(data.entries, 'weight');
  const trendAll = exponentialTrend(all);
  const idxs = all.map((p, i) => [p, i] as const).filter(([p]) => p.date >= from && p.date <= to);
  const points = idxs.map(([p]) => p);
  const trend = idxs.map(([, i]) => trendAll[i]);
  const values = points.map((p) => p.value);
  const min = points.reduce<Point | null>((m, p) => (!m || p.value < m.value ? p : m), null);
  const max = points.reduce<Point | null>((m, p) => (!m || p.value > m.value ? p : m), null);

  const keys = [...Object.keys(MEASUREMENT_LABELS), ...data.customMetrics.map((m) => `custom:${m.id}`)] as MeasurementKey[];
  const measurements = keys.map((k) => summarize(data, k, from, to)).filter((m) => m.count > 0);

  const logIdx = indexLogs(data.habitLogs);
  const habits: HabitSummary[] = data.habits.map((h) => {
    const periods = habitPeriods(h, logIdx, to).filter((p) => p.end >= from && p.start <= to && p.status !== 'pending');
    const done = periods.filter((p) => p.status === 'done').length;
    return {
      id: h.id,
      name: h.name,
      icon: h.icon,
      scheduled: periods.length,
      done,
      rate: periods.length ? done / periods.length : null,
      bestStreakInPeriod: streakRuns(periods).best,
    };
  }).filter((h) => h.scheduled > 0);
  const totS = habits.reduce((s, h) => s + h.scheduled, 0);
  const totD = habits.reduce((s, h) => s + h.done, 0);

  const defs = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
  const achievements = data.achievements
    .filter((a) => a.date >= from && a.date <= to && defs.has(a.id))
    .map((a) => ({ id: a.id, title: defs.get(a.id)!.title, icon: defs.get(a.id)!.icon, date: a.date }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from,
    to,
    days: diffDays(to, from) + 1,
    weight: {
      points,
      trend,
      start: values[0] ?? null,
      end: values[values.length - 1] ?? null,
      change: values.length > 1 ? values[values.length - 1] - values[0] : null,
      trendChange: trend.length > 1 ? trend[trend.length - 1] - trend[0] : null,
      average: values.length ? mean(values) : null,
      min,
      max,
      count: data.entries.filter((e) => e.weight != null && e.date >= from && e.date <= to).length,
      loggedDays: points.length,
    },
    bodyFat: summarize(data, 'bodyFat', from, to),
    measurements,
    habits,
    habitRate: totS ? totD / totS : null,
    achievements,
    photos: data.photos.filter((p) => p.date >= from && p.date <= to).map((p) => ({ id: p.id, date: p.date, category: p.category })),
    entries: data.entries.filter((e) => e.date >= from && e.date <= to),
  };
}
