import type { AppData, Goal, ISODate } from '@/domain/types';
import { ageFromBirthYear, today as todayFn } from '@/lib/dates';
import { dailySeries, exponentialTrend, trendChange, type Point } from '@/lib/math/series';
import { forecastGoal, type Forecast } from '@/lib/math/forecast';
import { goalProgress, maintenanceStatus, type GoalProgress, type MaintenanceStatus } from '@/lib/math/progress';
import { bmi, bmiCategory, type BmiCategory } from '@/lib/math/body';
import { activeGoal } from '@/lib/insights';

export type ProgressStatus = 'no_data' | 'no_goal' | 'collecting' | 'on_track' | 'slow' | 'stalled' | 'off_track' | 'reached' | 'maintenance_in' | 'maintenance_out';

export const STATUS_TEXT: Record<ProgressStatus, { title: string; tone: 'positive' | 'neutral' | 'warn' | 'info' }> = {
  no_data: { title: 'Нет измерений', tone: 'info' },
  no_goal: { title: 'Цель не задана', tone: 'info' },
  collecting: { title: 'Собираем данные', tone: 'info' },
  on_track: { title: 'По плану', tone: 'positive' },
  slow: { title: 'Медленнее плана', tone: 'neutral' },
  stalled: { title: 'Плато', tone: 'neutral' },
  off_track: { title: 'Тренд от цели', tone: 'warn' },
  reached: { title: 'Цель достигнута', tone: 'positive' },
  maintenance_in: { title: 'В целевом диапазоне', tone: 'positive' },
  maintenance_out: { title: 'Вне диапазона', tone: 'warn' },
};

export interface Summary {
  points: Point[];
  trend: number[];
  latest: Point | null;
  /** Smoothed current weight: robust, not swayed by one reading. */
  current: number | null;
  goal: Goal | null;
  target: number | null;
  progress: GoalProgress | null;
  change7: number | null;
  change30: number | null;
  forecast: Forecast;
  status: ProgressStatus;
  maintenance: MaintenanceStatus | null;
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  age: number | null;
}

export function computeSummary(data: AppData, asOf: ISODate = todayFn()): Summary {
  const points = dailySeries(data.entries, 'weight');
  const trend = exponentialTrend(points);
  const latest = points[points.length - 1] ?? null;
  const current = trend.length ? trend[trend.length - 1] : null;
  const goal = activeGoal(data);
  const target = goal?.targetWeight ?? null;
  const forecast = forecastGoal(points, target, asOf);
  // progress uses the smoothed level so one heavy/light day doesn't swing it
  const level = forecast.level ?? current;
  const progress = goal && target != null && level != null ? goalProgress(goal.startWeight, target, level) : null;
  const m = data.maintenance?.enabled ? data.maintenance : null;
  const maintenance = m && current != null ? maintenanceStatus(m.centerWeight, m.toleranceKg, current) : null;
  const age = data.profile ? ageFromBirthYear(data.profile.birthYear, asOf) : null;
  const b = data.profile && current != null ? bmi(current, data.profile.heightCm) : null;

  let status: ProgressStatus;
  if (!points.length) status = 'no_data';
  else if (maintenance) status = maintenance.state === 'inside' ? 'maintenance_in' : 'maintenance_out';
  else if (!goal || target == null) status = 'no_goal';
  else if (progress?.state === 'reached' || forecast.status === 'reached') status = 'reached';
  else if (forecast.status === 'insufficient') status = 'collecting';
  else if (forecast.status === 'away') status = 'off_track';
  else if (forecast.status === 'flat') status = 'stalled';
  else if (forecast.pctPerWeek != null && forecast.pctPerWeek < goal.pacePctPerWeek * 0.6) status = 'slow';
  else status = 'on_track';

  return {
    points,
    trend,
    latest,
    current,
    goal,
    target,
    progress,
    change7: trendChange(points, asOf, 7),
    change30: trendChange(points, asOf, 30),
    forecast,
    status,
    maintenance,
    bmi: b,
    bmiCategory: b != null && age != null ? bmiCategory(b, age) : null,
    age,
  };
}
