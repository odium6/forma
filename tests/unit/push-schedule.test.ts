import { describe, expect, it } from 'vitest';
import { applySnooze, dueDeliveries, EMPTY_STATE, MAX_SNOOZES, wallClock, type SubConfig } from '../../worker/src/schedule';
import type { Reminder } from '@/domain/types';

const rem = (over: Partial<Reminder> = {}): Reminder => ({ id: 'r1', enabled: true, label: 'Вес', kind: 'weigh', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], parity: 'all', createdAt: 0, ...over });
const cfg = (over: Partial<SubConfig> = {}): SubConfig => ({ reminders: [rem()], quietHours: { enabled: false, start: '22:30', end: '07:00' }, motivation: false, snoozeMinutes: 30, ...over });
// 2026-01-05 is a Monday. 05:00 UTC = 08:00 Moscow (UTC+3).
const at = (iso: string) => new Date(iso);

describe('push schedule (server)', () => {
  it('converts UTC to the user wall clock', () => {
    const w = wallClock(at('2026-01-05T05:00:00Z'), 'Europe/Moscow');
    expect([w.getDate(), w.getHours(), w.getMinutes()]).toEqual([5, 8, 0]);
    expect(wallClock(at('2026-07-05T12:00:00Z'), 'America/New_York').getHours()).toBe(8); // DST: UTC−4
  });

  it('fires once at the local time, never twice', () => {
    const tz = 'Europe/Moscow';
    expect(dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T04:59:00Z'), tz).deliveries).toHaveLength(0);
    const first = dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T05:00:20Z'), tz);
    expect(first.deliveries).toHaveLength(1);
    expect(first.deliveries[0].url).toBe('./#/?entry=1');
    const again = dueDeliveries(cfg(), first.state, at('2026-01-05T05:01:00Z'), tz);
    expect(again.deliveries).toHaveLength(0);
    // next day fires again
    expect(dueDeliveries(cfg(), again.state, at('2026-01-06T05:00:30Z'), tz).deliveries).toHaveLength(1);
  });

  it('catches up a missed tick within the lookback window only', () => {
    expect(dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T05:07:00Z'), 'Europe/Moscow').deliveries).toHaveLength(1);
    expect(dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T05:30:00Z'), 'Europe/Moscow').deliveries).toHaveLength(0);
  });

  it('does not send when already done or skipped today', () => {
    const now = at('2026-01-05T05:00:30Z');
    expect(dueDeliveries(cfg(), { ...EMPTY_STATE, done: { weigh: '2026-01-05' } }, now, 'Europe/Moscow').deliveries).toHaveLength(0);
    expect(dueDeliveries(cfg(), { ...EMPTY_STATE, skip: { r1: '2026-01-05' } }, now, 'Europe/Moscow').deliveries).toHaveLength(0);
    // yesterday's markers don't block today
    expect(dueDeliveries(cfg(), { ...EMPTY_STATE, done: { weigh: '2026-01-04' } }, now, 'Europe/Moscow').deliveries).toHaveLength(1);
  });

  it('respects quiet hours and week parity', () => {
    const quiet = { enabled: true, start: '22:30', end: '07:00' };
    const late = cfg({ reminders: [rem({ time: '23:00' })], quietHours: quiet });
    expect(dueDeliveries(late, EMPTY_STATE, at('2026-01-05T20:00:30Z'), 'Europe/Moscow').deliveries).toHaveLength(0); // 23:00 local
    expect(dueDeliveries(late, EMPTY_STATE, at('2026-01-06T04:00:30Z'), 'Europe/Moscow').deliveries).toHaveLength(1); // 07:00 next day
    // ISO week of 2026-01-05 is 2 (even)
    expect(dueDeliveries(cfg({ reminders: [rem({ parity: 'odd' })] }), EMPTY_STATE, at('2026-01-05T05:00:30Z'), 'Europe/Moscow').deliveries).toHaveLength(0);
    expect(dueDeliveries(cfg({ reminders: [rem({ parity: 'even' })] }), EMPTY_STATE, at('2026-01-05T05:00:30Z'), 'Europe/Moscow').deliveries).toHaveLength(1);
  });

  it('snooze re-sends once and is capped', () => {
    const tz = 'Europe/Moscow';
    const fired = dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T05:00:30Z'), tz).state;
    let s = applySnooze(fired, 'r1', at('2026-01-05T05:01:00Z').getTime(), 30);
    expect(dueDeliveries(cfg(), s, at('2026-01-05T05:20:00Z'), tz).deliveries).toHaveLength(0);
    const r = dueDeliveries(cfg(), s, at('2026-01-05T05:31:30Z'), tz);
    expect(r.deliveries).toHaveLength(1);
    expect(dueDeliveries(cfg(), r.state, at('2026-01-05T05:32:30Z'), tz).deliveries).toHaveLength(0);
    for (let i = 0; i < 10; i++) s = applySnooze(s, 'r1', 0, 30);
    expect(s.snooze.r1.count).toBe(MAX_SNOOZES);
  });

  it('disabled reminders are ignored and motivation is optional', () => {
    expect(dueDeliveries(cfg({ reminders: [rem({ enabled: false })] }), EMPTY_STATE, at('2026-01-05T05:00:30Z'), 'Europe/Moscow').deliveries).toHaveLength(0);
    const withMot = dueDeliveries(cfg({ motivation: true }), EMPTY_STATE, at('2026-01-05T05:00:30Z'), 'Europe/Moscow').deliveries[0].body;
    const without = dueDeliveries(cfg(), EMPTY_STATE, at('2026-01-05T05:00:30Z'), 'Europe/Moscow').deliveries[0].body;
    expect(withMot.length).toBeGreaterThan(without.length);
  });
});
