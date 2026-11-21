import type { AppData, ISODate } from '@/domain/types';
import { addDays, today as todayFn } from '@/lib/dates';
import { habitStats, indexLogs } from '@/lib/habits';

export interface StreakInfo {
  /** Target id: 'weigh' or a habit id. */
  id: string;
  label: string;
  icon: string;
  count: number;
  unit: 'day' | 'week';
  todayDone: boolean;
}

/** Consecutive days with a weight entry. Today not logged yet does not break the run. */
export function weighStreak(data: AppData, asOf: ISODate = todayFn()): { count: number; todayDone: boolean } {
  const days = new Set(data.entries.filter((e) => e.weight != null).map((e) => e.date));
  const todayDone = days.has(asOf);
  let d = todayDone ? asOf : addDays(asOf, -1);
  let count = 0;
  while (days.has(d)) {
    count++;
    d = addDays(d, -1);
  }
  return { count, todayDone };
}

/** All streak targets the user can pin to the big flame: weighing plus every active habit. */
export function streakTargets(data: AppData, asOf: ISODate = todayFn()): StreakInfo[] {
  const w = weighStreak(data, asOf);
  const idx = indexLogs(data.habitLogs);
  return [
    { id: 'weigh', label: 'Взвешивание', icon: '⚖️', count: w.count, unit: 'day', todayDone: w.todayDone },
    ...data.habits
      .filter((h) => !h.archivedAt)
      .map((h) => {
        const s = habitStats(h, idx, asOf);
        return { id: h.id, label: h.name, icon: h.icon, count: s.current, unit: s.unit, todayDone: s.todayDone };
      }),
  ];
}

export function mainStreak(data: AppData, asOf?: ISODate): StreakInfo {
  const all = streakTargets(data, asOf);
  return all.find((x) => x.id === data.settings.mainStreak) ?? all[0];
}
