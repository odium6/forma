import type { Reminder, Settings } from '../../src/domain/types';
import { lastOccurrence } from '../../src/lib/reminders';
import { toISODate } from '../../src/lib/dates';
import { reminderText, reminderUrl } from '../../src/lib/notificationTexts';

/**
 * Pure scheduling logic for the push Worker (unit-tested in tests/unit/push-schedule.test.ts).
 * A user's wall-clock time is represented as a Date whose *runtime-local* fields equal the
 * user's local fields ("wall time"), so the shared reminder rules from src/lib/reminders.ts
 * (which use local getters) work unchanged in any runtime time zone (UTC in Workers).
 */

export interface SubConfig {
  reminders: Reminder[];
  quietHours: Settings['quietHours'];
  motivation: boolean;
  snoozeMinutes: number;
  /** Old clients did not send it; absent means the reminder always arrives. */
  skipIfDone?: boolean;
}

export interface SubState {
  /** reminderId → wall-time ms of the occurrence already delivered. */
  fired: Record<string, number>;
  /** reminderId → real UTC ms when a snoozed reminder is due, and how often it was snoozed. */
  snooze: Record<string, { until: number; count: number }>;
  /** reminderId → local date skipped by the user ("Пропустить сегодня"). */
  skip: Record<string, string>;
  /** reminder kind → local date on which the action was already done in the app. */
  done: Partial<Record<Reminder['kind'], string>>;
}

export const EMPTY_STATE: SubState = { fired: {}, snooze: {}, skip: {}, done: {} };
export const MAX_SNOOZES = 3;
/** Missed cron ticks are caught up within this window; older occurrences are dropped. */
export const LOOKBACK_MS = 10 * 60 * 1000;

export function wallClock(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

export function wallDate(wall: Date): string {
  return toISODate(wall);
}

export interface Delivery {
  reminder: Reminder;
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Decides what to send now. Returns the deliveries and the updated state; each occurrence
 * is delivered at most once, snoozes at most MAX_SNOOZES times, and nothing is sent for a
 * reminder that was skipped today or whose action is already done today.
 */
export function dueDeliveries(cfg: SubConfig, state: SubState, nowUtc: Date, timeZone: string): { deliveries: Delivery[]; state: SubState; changed: boolean } {
  const wall = wallClock(nowUtc, timeZone);
  const today = wallDate(wall);
  const next: SubState = { fired: { ...state.fired }, snooze: { ...state.snooze }, skip: { ...state.skip }, done: { ...state.done } };
  const out: Delivery[] = [];
  let changed = false;

  for (const r of cfg.reminders) {
    if (!r.enabled) continue;
    const skipped = next.skip[r.id] === today;
    const done = !!cfg.skipIfDone && next.done[r.kind] === today && r.kind !== 'custom';
    const make = (suffix: string): Delivery => ({
      reminder: r,
      title: r.label || 'FORMA',
      body: reminderText(r, `${r.id}${today}${suffix}`, cfg.motivation),
      url: reminderUrl(r.kind),
      tag: `forma-${r.id}`,
    });

    const sn = next.snooze[r.id];
    if (sn && sn.until > 0 && sn.until <= nowUtc.getTime()) {
      next.snooze[r.id] = { until: 0, count: sn.count };
      changed = true;
      if (!skipped && !done) out.push(make(`s${sn.count}`));
      continue;
    }

    const occ = lastOccurrence(r, wall, cfg.quietHours, LOOKBACK_MS);
    if (!occ) continue;
    const t = occ.getTime();
    if ((next.fired[r.id] ?? 0) >= t) continue;
    next.fired[r.id] = t;
    next.snooze[r.id] = { until: 0, count: 0 };
    changed = true;
    if (!skipped && !done) out.push(make(''));
  }

  // keep state small: forget skip/done markers from previous days
  for (const [k, d] of Object.entries(next.skip)) if (d !== today) (delete next.skip[k], (changed = true));
  for (const [k, d] of Object.entries(next.done)) if (d !== today) (delete next.done[k as Reminder['kind']], (changed = true));
  return { deliveries: out, state: next, changed };
}

export function applySnooze(state: SubState, reminderId: string, nowUtc: number, minutes: number): SubState {
  const cur = state.snooze[reminderId] ?? { until: 0, count: 0 };
  if (cur.count >= MAX_SNOOZES) return state;
  return { ...state, snooze: { ...state.snooze, [reminderId]: { until: nowUtc + minutes * 60_000, count: cur.count + 1 } } };
}
