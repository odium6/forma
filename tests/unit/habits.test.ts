import { describe, expect, it } from 'vitest';
import { habitPeriods, habitStats, indexLogs, isDoneValue, streakRuns, withSchedule } from '@/lib/habits';
import type { HabitLog } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { habit } from './helpers';

const logs = (habitId: string, dates: string[], value = 1): HabitLog[] => dates.map((date) => ({ id: `${habitId}|${date}`, habitId, date, value, updatedAt: 0 }));
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('habit completion', () => {
  it('handles check / count / limit kinds', () => {
    expect(isDoneValue(habit(), 1)).toBe(true);
    expect(isDoneValue(habit({ kind: 'count', target: 8 }), 7)).toBe(false);
    expect(isDoneValue(habit({ kind: 'count', target: 8 }), 8)).toBe(true);
    expect(isDoneValue(habit({ kind: 'limit', target: 1 }), 0)).toBe(true);
    expect(isDoneValue(habit({ kind: 'limit', target: 1 }), 2)).toBe(false);
    expect(isDoneValue(habit({ kind: 'limit', target: 1 }), undefined)).toBe(false);
  });
});

describe('streaks', () => {
  it('counts consecutive days, today pending does not break it', () => {
    const h = habit();
    const s = habitStats(h, logs('h1', days('2026-01-05', 5)), '2026-01-10');
    expect(s.current).toBe(5);
    expect(s.todayDone).toBe(false);
  });
  it('forgives a single miss but not two in a row', () => {
    const h = habit();
    const one = logs('h1', [...days('2026-01-05', 4), ...days('2026-01-10', 3)]); // miss on 01-09
    expect(habitStats(h, one, '2026-01-12').current).toBe(7);
    const two = logs('h1', [...days('2026-01-05', 4), ...days('2026-01-11', 2)]); // miss 09, 10
    expect(habitStats(h, two, '2026-01-12').current).toBe(2);
    expect(habitStats(h, two, '2026-01-12').best).toBe(4);
  });
  it('only one forgiven miss per 7 periods', () => {
    const h = habit();
    const l = logs('h1', ['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-10', '2026-01-11']);
    // misses on 07 and 09 within a week → streak restarts after the second miss
    expect(habitStats(h, l, '2026-01-11').current).toBe(2); // 10, 11
  });
  it('weekday schedules ignore unscheduled days', () => {
    const h = habit({ schedules: [{ from: '2026-01-05', schedule: { type: 'weekdays', days: [0, 2, 4] } }] });
    // Mon 05, Wed 07, Fri 09, Mon 12
    expect(habitStats(h, logs('h1', ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12']), '2026-01-13').current).toBe(4);
  });
  it('times-per-week counts weeks', () => {
    const h = habit({ schedules: [{ from: '2026-01-05', schedule: { type: 'timesPerWeek', times: 2 } }] });
    const l = logs('h1', ['2026-01-05', '2026-01-07', '2026-01-13', '2026-01-15', '2026-01-19']);
    const periods = habitPeriods(h, indexLogs(l), '2026-01-20');
    expect(periods.map((p) => p.status)).toEqual(['done', 'done', 'pending']);
    expect(streakRuns(periods).current).toBe(2);
  });
  it('schedule changes keep history and stored best streak', () => {
    const h = habit({ bestStreak: 12 });
    const l = logs('h1', days('2026-01-05', 10));
    const changed = { ...h, schedules: withSchedule(h, { type: 'weekdays', days: [0] }, '2026-01-15') };
    const s = habitStats(changed, l, '2026-01-20');
    expect(s.best).toBe(12); // stored record survives
    expect(changed.schedules).toHaveLength(2);
    expect(changed.schedules[0].schedule.type).toBe('daily');
  });
  it('week and month completion rates', () => {
    const h = habit();
    const s = habitStats(h, logs('h1', days('2026-01-05', 14).filter((_, i) => i % 2 === 0)), '2026-01-18');
    expect(s.weekRate).toBeCloseTo(3 / 6, 5);
    expect(s.total).toBe(7);
  });
});
