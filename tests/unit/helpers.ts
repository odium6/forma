import type { AppData, Entry, Habit } from '@/domain/types';
import { EMPTY_DATA } from '@/state/store';
import { addDays } from '@/lib/dates';

let n = 0;
export function entry(date: string, weight: number | null, extra: Partial<Entry> = {}): Entry {
  n++;
  return { id: `e${n}`, date, time: '08:00', weight, bodyFat: null, measurements: {}, note: '', source: 'manual', createdAt: n, updatedAt: n, ...extra };
}

/** Linear series with optional deterministic noise. */
export function series(start: string, days: number, from: number, perDay: number, noise = 0, every = 1): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < days; i += every) {
    const wobble = noise ? Math.sin(i * 1.7) * noise : 0;
    out.push(entry(addDays(start, i), Math.round((from + perDay * i + wobble) * 10) / 10));
  }
  return out;
}

export function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: 'Вода', icon: '💧', color: '#5ad16c', kind: 'check', target: 1, unit: '', schedules: [{ from: '2026-01-05', schedule: { type: 'daily' } }], createdAt: 0, archivedAt: null, bestStreak: 0, order: 0, ...over };
}

export function data(over: Partial<AppData> = {}): AppData {
  return { ...EMPTY_DATA, ...over };
}
