import type { AppData, ISODate } from '@/domain/types';
import { dayNumber, fromDayNumber, today as todayFn } from '@/lib/dates';
import { dailySeries, exponentialTrend } from '@/lib/math/series';
import { habitPeriods, indexLogs, isDoneValue, streakRuns } from '@/lib/habits';

export type AchievementGroup = 'start' | 'regularity' | 'progress' | 'habits' | 'photos' | 'goal';

export interface AchievementDef {
  id: string;
  group: AchievementGroup;
  title: string;
  description: string;
  icon: string;
  points: number;
  /** Optional progress toward this achievement: [current, required]. */
  progress?: (ctx: Ctx) => [number, number];
  /** Date the achievement was earned according to the data, or null. */
  earned: (ctx: Ctx) => ISODate | null;
}

interface Ctx {
  data: AppData;
  asOf: ISODate;
  weightDays: number[];
  weightDates: ISODate[];
  trend: number[];
  loggingRunReached: (n: number) => ISODate | null;
  longestLoggingRun: number;
}

function buildCtx(data: AppData, asOf: ISODate): Ctx {
  const pts = dailySeries(data.entries, 'weight');
  const trend = exponentialTrend(pts);
  const days = [...new Set(data.entries.map((e) => dayNumber(e.date)))].sort((a, b) => a - b);
  // first date on which a run of n consecutive logged days was completed
  const reached = new Map<number, ISODate>();
  let run = 0;
  let longest = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    if (!reached.has(run)) reached.set(run, fromDayNumber(days[i]));
  }
  return {
    data,
    asOf,
    weightDays: pts.map((p) => p.day),
    weightDates: pts.map((p) => p.date),
    trend,
    loggingRunReached: (n) => reached.get(n) ?? null,
    longestLoggingRun: longest,
  };
}

function activeOrAchievedGoal(data: AppData) {
  return [...data.goals].reverse().find((g) => g.status !== 'archived' && g.targetWeight != null) ?? null;
}

/** First date on which the smoothed trend moved `kg` from the goal start toward the target. */
function movedTowardGoal(ctx: Ctx, kg: number): ISODate | null {
  const g = activeOrAchievedGoal(ctx.data);
  const dir = g && g.targetWeight != null ? Math.sign(g.targetWeight - g.startWeight) : -1;
  const start = g?.startWeight ?? (ctx.trend[0] ?? null);
  if (start == null || dir === 0) return null;
  const from = g ? dayNumber(g.startDate) : -Infinity;
  for (let i = 0; i < ctx.trend.length; i++) {
    if (ctx.weightDays[i] < from) continue;
    if ((ctx.trend[i] - start) * dir >= kg) return ctx.weightDates[i];
  }
  return null;
}

function goalFraction(ctx: Ctx, frac: number): ISODate | null {
  const g = activeOrAchievedGoal(ctx.data);
  if (!g || g.targetWeight == null) return null;
  const total = Math.abs(g.targetWeight - g.startWeight);
  if (total < 0.5) return null;
  return movedTowardGoal(ctx, total * frac);
}

function bestHabitStreakDate(ctx: Ctx, n: number): ISODate | null {
  const idx = indexLogs(ctx.data.habitLogs);
  let best: ISODate | null = null;
  for (const h of ctx.data.habits) {
    const periods = habitPeriods(h, idx, ctx.asOf);
    // walk forward and find the first period where the streak reached n
    for (let i = 0; i < periods.length; i++) {
      if (periods[i].status !== 'done') continue;
      const { best: b } = streakRuns(periods.slice(0, i + 1));
      if (b >= n) {
        if (!best || periods[i].end < best) best = periods[i].end;
        break;
      }
    }
  }
  return best;
}

function maxHabitStreak(ctx: Ctx): number {
  const idx = indexLogs(ctx.data.habitLogs);
  return Math.max(0, ...ctx.data.habits.map((h) => streakRuns(habitPeriods(h, idx, ctx.asOf)).best));
}

const regularity = (n: number, points: number): AchievementDef => ({
  id: `log_run_${n}`,
  group: 'regularity',
  title: `${n} дней регулярности`,
  description: `Вносить данные ${n} дней подряд`,
  icon: n >= 30 ? '🔥' : '📅',
  points,
  progress: (c) => [Math.min(c.longestLoggingRun, n), n],
  earned: (c) => c.loggingRunReached(n),
});

const kgMilestone = (kg: number, points: number): AchievementDef => ({
  id: `kg_${kg}`,
  group: 'progress',
  title: kg === 1 ? 'Первый килограмм' : `${kg} кг к цели`,
  description: `Сглаженный тренд сместился на ${kg} кг в сторону цели`,
  icon: '⚖️',
  points,
  earned: (c) => movedTowardGoal(c, kg),
});

const fraction = (pct: number, points: number): AchievementDef => ({
  id: `goal_${pct}`,
  group: 'goal',
  title: `${pct}% пути`,
  description: `Пройти ${pct}% пути к текущей цели по весу`,
  icon: pct >= 75 ? '🏔️' : '⛰️',
  points,
  earned: (c) => goalFraction(c, pct / 100),
});

const habitStreak = (n: number, points: number, title: string): AchievementDef => ({
  id: `habit_streak_${n}`,
  group: 'habits',
  title,
  description: `Серия ${n} по любой привычке`,
  icon: '✨',
  points,
  progress: (c) => [Math.min(maxHabitStreak(c), n), n],
  earned: (c) => bestHabitStreakDate(c, n),
});

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_entry',
    group: 'start',
    title: 'Первое измерение',
    description: 'Внести первый вес',
    icon: '🌱',
    points: 10,
    earned: (c) => c.weightDates[0] ?? null,
  },
  {
    id: 'first_week',
    group: 'start',
    title: 'Первая неделя наблюдений',
    description: 'Записи веса охватывают 7 дней',
    icon: '🗓️',
    points: 15,
    earned: (c) => {
      const first = c.weightDays[0];
      const hit = c.weightDays.find((d) => d - first >= 6);
      return hit != null && c.weightDays.length >= 3 ? fromDayNumber(hit) : null;
    },
  },
  {
    id: 'first_measurements',
    group: 'start',
    title: 'Сантиметр за сантиметром',
    description: 'Внести первые измерения тела',
    icon: '📏',
    points: 10,
    earned: (c) => [...c.data.entries].sort((a, b) => a.date.localeCompare(b.date)).find((e) => Object.keys(e.measurements).length > 0)?.date ?? null,
  },
  regularity(7, 20),
  regularity(10, 25),
  regularity(30, 60),
  regularity(100, 150),
  kgMilestone(1, 20),
  kgMilestone(5, 50),
  kgMilestone(10, 90),
  fraction(25, 30),
  fraction(50, 50),
  fraction(75, 70),
  {
    id: 'goal_reached',
    group: 'goal',
    title: 'Цель достигнута',
    description: 'Достичь основной цели по весу',
    icon: '🏆',
    points: 150,
    earned: (c) => c.data.goals.find((g) => g.status === 'achieved' && g.achievedAt)?.achievedAt ?? null,
  },
  {
    id: 'first_habit',
    group: 'habits',
    title: 'Первый шаг',
    description: 'Отметить выполнение привычки',
    icon: '✅',
    points: 10,
    earned: (c) => {
      const byId = new Map(c.data.habits.map((h) => [h.id, h]));
      const done = c.data.habitLogs.filter((l) => {
        const h = byId.get(l.habitId);
        return h && isDoneValue(h, l.value);
      });
      return done.map((l) => l.date).sort()[0] ?? null;
    },
  },
  habitStreak(7, 25, 'Неделя в ритме'),
  habitStreak(21, 60, 'Привычка сформирована'),
  habitStreak(50, 100, 'Железная серия'),
  {
    id: 'first_photo',
    group: 'photos',
    title: 'Точка отсчёта',
    description: 'Сохранить первое фото прогресса',
    icon: '📸',
    points: 15,
    earned: (c) => c.data.photos.map((p) => p.date).sort()[0] ?? null,
  },
  {
    id: 'photo_set',
    group: 'photos',
    title: 'Полный ракурс',
    description: 'Фото спереди, сбоку и сзади за один день',
    icon: '🖼️',
    points: 25,
    earned: (c) => {
      const byDate = new Map<ISODate, Set<string>>();
      for (const p of c.data.photos) byDate.set(p.date, (byDate.get(p.date) ?? new Set()).add(p.category));
      return [...byDate.entries()].filter(([, s]) => s.has('front') && s.has('side') && s.has('back')).map(([d]) => d).sort()[0] ?? null;
    },
  },
  {
    id: 'maintenance_30',
    group: 'goal',
    title: 'Устойчивая форма',
    description: '30 дней в режиме поддержания',
    icon: '🧭',
    points: 80,
    earned: (c) => {
      const m = c.data.maintenance;
      if (!m?.enabled) return null;
      return dayNumber(c.asOf) - dayNumber(m.startedAt) >= 30 ? fromDayNumber(dayNumber(m.startedAt) + 30) : null;
    },
  },
];

export function evaluateAchievements(data: AppData, asOf: ISODate = todayFn()): { id: string; date: ISODate }[] {
  const ctx = buildCtx(data, asOf);
  const out: { id: string; date: ISODate }[] = [];
  for (const a of ACHIEVEMENTS) {
    const d = a.earned(ctx);
    if (d && d <= asOf) out.push({ id: a.id, date: d });
  }
  return out;
}

export function achievementProgress(data: AppData, def: AchievementDef, asOf: ISODate = todayFn()): [number, number] | null {
  return def.progress ? def.progress(buildCtx(data, asOf)) : null;
}

export const LEVELS = [
  { min: 0, title: 'Старт' },
  { min: 40, title: 'Ритм' },
  { min: 100, title: 'Фокус' },
  { min: 200, title: 'Форма' },
  { min: 350, title: 'Баланс' },
  { min: 550, title: 'Мастер' },
  { min: 800, title: 'Легенда' },
];

export function levelFor(points: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].min) i++;
  const next = LEVELS[i + 1] ?? null;
  return {
    level: i + 1,
    title: LEVELS[i].title,
    points,
    next: next ? { title: next.title, at: next.min, left: next.min - points } : null,
    fraction: next ? (points - LEVELS[i].min) / (next.min - LEVELS[i].min) : 1,
  };
}

export function totalPoints(unlocked: { id: string }[]): number {
  const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a.points]));
  return unlocked.reduce((s, u) => s + (byId.get(u.id) ?? 0), 0);
}
