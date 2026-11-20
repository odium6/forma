import type { Habit, HabitLog, HabitSchedule, HabitScheduleVersion, ISODate } from '@/domain/types';
import { addDays, dayNumber, rangeDays, toISODate, weekday } from '@/lib/dates';

export function habitStartDate(h: Habit): ISODate {
  return h.schedules[0]?.from ?? toISODate(new Date(h.createdAt));
}

export function scheduleOn(h: Habit, date: ISODate): HabitSchedule | null {
  let current: HabitSchedule | null = null;
  for (const v of h.schedules) {
    if (v.from <= date) current = v.schedule;
    else break;
  }
  return current;
}

/** Whether the habit is expected on this exact day (weekly-quota habits are expected every day). */
export function isScheduledOn(h: Habit, date: ISODate): boolean {
  const s = scheduleOn(h, date);
  if (!s) return false;
  if (h.archivedAt && date > toISODate(new Date(h.archivedAt))) return false;
  if (s.type === 'weekdays') return s.days.includes(weekday(date));
  return true;
}

export function isDoneValue(h: Habit, value: number | undefined): boolean {
  if (value == null) return false;
  if (h.kind === 'check') return value >= 1;
  if (h.kind === 'count') return value >= h.target;
  return value <= h.target; // limit: a logged value within the limit
}

export type LogIndex = Map<string, number>;

export function indexLogs(logs: HabitLog[]): LogIndex {
  const m: LogIndex = new Map();
  for (const l of logs) m.set(`${l.habitId}|${l.date}`, l.value);
  return m;
}

export function logValue(idx: LogIndex, habitId: string, date: ISODate): number | undefined {
  return idx.get(`${habitId}|${date}`);
}

export interface Period {
  start: ISODate;
  end: ISODate;
  required: number;
  completed: number;
  status: 'done' | 'missed' | 'pending';
}

/**
 * Converts history into evaluation periods: one per scheduled day, or one per week
 * for "N times per week". Each day uses the schedule version that was active then.
 */
export function habitPeriods(h: Habit, idx: LogIndex, asOf: ISODate): Period[] {
  const start = habitStartDate(h);
  if (start > asOf) return [];
  const out: Period[] = [];
  let week: Period | null = null;
  let weekTimes = 0;
  const closeWeek = () => {
    if (!week) return;
    const span = dayNumber(week.end) - dayNumber(week.start) + 1;
    const ongoing = week.end === asOf && weekday(asOf) !== 6;
    // an ongoing week can still be completed on its remaining days
    const capacity = ongoing ? span + (6 - weekday(asOf)) : span;
    week.required = Math.min(weekTimes, capacity);
    week.status = week.completed >= week.required ? 'done' : ongoing ? 'pending' : 'missed';
    out.push(week);
    week = null;
  };
  for (const date of rangeDays(start, asOf)) {
    const s = scheduleOn(h, date);
    if (!s) continue;
    if (h.archivedAt && date > toISODate(new Date(h.archivedAt))) break;
    const done = isDoneValue(h, logValue(idx, h.id, date));
    if (s.type === 'timesPerWeek') {
      if (!week || weekday(date) === 0 || weekTimes !== s.times) {
        closeWeek();
        week = { start: date, end: date, required: 0, completed: 0, status: 'pending' };
        weekTimes = s.times;
      }
      week.end = date;
      if (done) week.completed++;
      if (weekday(date) === 6) closeWeek();
      continue;
    }
    closeWeek();
    if (s.type === 'weekdays' && !s.days.includes(weekday(date))) continue;
    out.push({ start: date, end: date, required: 1, completed: done ? 1 : 0, status: done ? 'done' : date === asOf ? 'pending' : 'missed' });
  }
  closeWeek();
  return out;
}

/**
 * Forgiving streaks: a single missed period does not break a streak, provided it is not
 * followed/preceded by another miss and there was no other miss in the last 7 periods.
 * Missed periods never add to the count.
 */
export function streakRuns(periods: Period[]): { current: number; best: number; atRisk: boolean } {
  let best = 0;
  let run = 0;
  let lastMissAt = -Infinity;
  let prevMissed = false;
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (p.status === 'pending') continue;
    if (p.status === 'done') {
      run++;
      prevMissed = false;
    } else {
      const forgivable = run > 0 && !prevMissed && i - lastMissAt > 7;
      if (forgivable) {
        lastMissAt = i;
        prevMissed = true;
      } else {
        run = 0;
        prevMissed = true;
        lastMissAt = i;
      }
    }
    best = Math.max(best, run);
  }
  // Two consecutive misses at the end would have reset `run`; one recent miss leaves it "at risk".
  const lastClosed = [...periods].reverse().find((p) => p.status !== 'pending');
  return { current: run, best, atRisk: run > 0 && lastClosed?.status === 'missed' };
}

export interface HabitStats {
  current: number;
  best: number;
  atRisk: boolean;
  total: number;
  weekRate: number | null;
  monthRate: number | null;
  todayScheduled: boolean;
  todayDone: boolean;
  todayValue: number | undefined;
  unit: 'day' | 'week';
}

function rate(periods: Period[], from: ISODate): number | null {
  const relevant = periods.filter((p) => p.end >= from && p.status !== 'pending');
  if (!relevant.length) return null;
  return relevant.filter((p) => p.status === 'done').length / relevant.length;
}

export function habitStats(h: Habit, logs: HabitLog[] | LogIndex, asOf: ISODate): HabitStats {
  const idx = logs instanceof Map ? logs : indexLogs(logs);
  const periods = habitPeriods(h, idx, asOf);
  const { current, best, atRisk } = streakRuns(periods);
  let total = 0;
  for (const [key, v] of idx) if (key.startsWith(`${h.id}|`) && isDoneValue(h, v)) total++;
  const todayValue = logValue(idx, h.id, asOf);
  const sched = scheduleOn(h, asOf);
  return {
    current,
    best: Math.max(best, h.bestStreak),
    atRisk,
    total,
    weekRate: rate(periods, addDays(asOf, -6)),
    monthRate: rate(periods, addDays(asOf, -29)),
    todayScheduled: isScheduledOn(h, asOf),
    todayDone: isDoneValue(h, todayValue),
    todayValue,
    unit: sched?.type === 'timesPerWeek' ? 'week' : 'day',
  };
}

export function describeSchedule(s: HabitSchedule): string {
  if (s.type === 'daily') return 'Каждый день';
  if (s.type === 'timesPerWeek') return `${s.times} раз${s.times >= 2 && s.times <= 4 ? 'а' : ''} в неделю`;
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const sorted = [...s.days].sort();
  if (sorted.join() === '0,1,2,3,4') return 'По будням';
  if (sorted.join() === '5,6') return 'По выходным';
  return sorted.map((d) => names[d]).join(', ');
}

/** Appends a schedule version effective from `from`, replacing a same-day version. */
export function withSchedule(h: Habit, schedule: HabitSchedule, from: ISODate): HabitScheduleVersion[] {
  const kept = h.schedules.filter((v) => v.from < from);
  if (!kept.length) return [{ from: h.schedules[0]?.from ?? from, schedule }];
  return [...kept, { from, schedule }];
}


export const HABIT_PRESETS: { name: string; icon: string; kind: Habit['kind']; target: number; unit: string }[] = [
  { name: 'Без сладких газировок', icon: '🥤', kind: 'check', target: 1, unit: '' },
  { name: 'Без фастфуда', icon: '🍔', kind: 'check', target: 1, unit: '' },
  { name: 'Сладкое — не больше 1 раза', icon: '🍫', kind: 'limit', target: 1, unit: 'раз' },
  { name: 'Ограничить мучное', icon: '🥐', kind: 'check', target: 1, unit: '' },
  { name: 'Вода', icon: '💧', kind: 'count', target: 8, unit: 'стаканов' },
  { name: 'Соблюдать план питания', icon: '🥗', kind: 'check', target: 1, unit: '' },
  { name: 'Шаги', icon: '👟', kind: 'count', target: 8000, unit: 'шагов' },
  { name: 'Тренировка', icon: '🏋️', kind: 'check', target: 1, unit: '' },
  { name: 'Сон 7+ часов', icon: '🌙', kind: 'check', target: 1, unit: '' },
];
