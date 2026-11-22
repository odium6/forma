import type { Reminder, Settings } from '../../src/domain/types';
import { inQuietHours, lastOccurrence, nextOccurrence } from '../../src/lib/reminders';
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
  /** Repeat an unanswered reminder every N minutes until done or skipped (0 = off; absent = 15). */
  repeatMinutes?: number;
}

export interface SubState {
  /** reminderId → wall-time ms of the occurrence already delivered. */
  fired: Record<string, number>;
  /** reminderId → real UTC ms when a snoozed reminder is due, and how often it was snoozed. */
  snooze: Record<string, { until: number; count: number }>;
  /** reminderId → local date skipped by the user ("Пропустить сегодня"). */
  skip: Record<string, string>;
  /** done key ('weigh', 'photo', 'habits' or 'habit:<id>') → local date on which it was done. */
  done: Record<string, string>;
  /** reminderId → repeat bookkeeping for today: real UTC ms of the last send and how many repeats. */
  nag?: Record<string, { date: string; last: number; count: number }>;
}

export const EMPTY_STATE: SubState = { fired: {}, snooze: {}, skip: {}, done: {}, nag: {} };
export const DEFAULT_REPEAT_MINUTES = 15;

/** What marks a reminder as answered today; null when there is nothing to check (plain custom reminders). */
export function doneKey(r: Pick<Reminder, 'kind' | 'habitId'>): string | null {
  if (r.kind === 'custom') return r.habitId ? `habit:${r.habitId}` : null;
  return r.kind;
}
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
  const next: SubState = { fired: { ...state.fired }, snooze: { ...state.snooze }, skip: { ...state.skip }, done: { ...state.done }, nag: { ...(state.nag ?? {}) } };
  const nag = next.nag!;
  const repeat = cfg.repeatMinutes ?? DEFAULT_REPEAT_MINUTES;
  const hhmm = `${String(wall.getHours()).padStart(2, '0')}:${String(wall.getMinutes()).padStart(2, '0')}`;
  const quietNow = inQuietHours(hhmm, cfg.quietHours);
  const out: Delivery[] = [];
  let changed = false;

  for (const r of cfg.reminders) {
    if (!r.enabled) continue;
    const skipped = next.skip[r.id] === today;
    const key = doneKey(r);
    const doneToday = key != null && next.done[key] === today;
    const done = !!cfg.skipIfDone && doneToday;
    const startNag = () => {
      if (key && repeat > 0) nag[r.id] = { date: today, last: nowUtc.getTime(), count: nag[r.id]?.date === today ? nag[r.id].count : 0 };
    };
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
      if (!skipped && !done) {
        out.push(make(`s${sn.count}`));
        startNag();
      }
      continue;
    }
    const snoozed = !!sn && sn.until > nowUtc.getTime();

    const occ = lastOccurrence(r, wall, cfg.quietHours, LOOKBACK_MS);
    if (occ && (next.fired[r.id] ?? 0) < occ.getTime()) {
      next.fired[r.id] = occ.getTime();
      next.snooze[r.id] = { until: 0, count: 0 };
      changed = true;
      if (!skipped && !done) {
        out.push(make(''));
        startNag();
      }
      continue;
    }

    // repeat an unanswered reminder until the action is done or the day is skipped
    const n = nag[r.id];
    if (n && n.date === today && key && repeat > 0 && !doneToday && !skipped && !snoozed && !quietNow && nowUtc.getTime() - n.last >= repeat * 60_000 - 5_000) {
      nag[r.id] = { date: today, last: nowUtc.getTime(), count: n.count + 1 };
      changed = true;
      out.push(make(`n${n.count + 1}`));
    }
  }
  for (const [k, v] of Object.entries(nag)) if (v.date !== today) (delete nag[k], (changed = true));

  // keep state small: forget skip/done markers from previous days
  for (const [k, d] of Object.entries(next.skip)) if (d !== today) (delete next.skip[k], (changed = true));
  for (const [k, d] of Object.entries(next.done)) if (d !== today) (delete next.done[k], (changed = true));
  return { deliveries: out, state: next, changed };
}

export function applySnooze(state: SubState, reminderId: string, nowUtc: number, minutes: number): SubState {
  const cur = state.snooze[reminderId] ?? { until: 0, count: 0 };
  if (cur.count >= MAX_SNOOZES) return state;
  return { ...state, snooze: { ...state.snooze, [reminderId]: { until: nowUtc + minutes * 60_000, count: cur.count + 1 } } };
}

/**
 * "I'm awake" trigger (e.g. from an iPhone Shortcuts automation): sends the weighing reminder now,
 * starts the repeat cycle and marks today's scheduled weighing reminders as delivered.
 */
export function wakeDelivery(cfg: SubConfig, state: SubState, nowUtc: Date, timeZone: string): { delivery: Delivery | null; state: SubState } {
  const wall = wallClock(nowUtc, timeZone);
  const today = wallDate(wall);
  const next: SubState = { ...state, fired: { ...state.fired }, nag: { ...(state.nag ?? {}) } };
  const weigh = cfg.reminders.filter((r) => r.enabled && r.kind === 'weigh');
  if (state.done.weigh === today || weigh.some((r) => state.skip[r.id] === today)) return { delivery: null, state };
  for (const r of weigh) {
    const occ = nextOccurrence(r, new Date(wall.getTime() - 60_000), cfg.quietHours);
    if (occ && wallDate(occ) === today) next.fired[r.id] = Math.max(next.fired[r.id] ?? 0, occ.getTime());
    next.nag![r.id] = { date: today, last: nowUtc.getTime(), count: 0 };
  }
  const r = weigh[0] ?? { id: '', enabled: true, label: 'Взвешивание', kind: 'weigh' as const, time: '07:00', days: [], parity: 'all' as const, createdAt: 0 };
  return {
    delivery: { reminder: r, title: r.label || 'Взвешивание', body: reminderText(r, `${today}wake`, cfg.motivation), url: reminderUrl('weigh'), tag: `forma-${r.id || 'wake'}` },
    state: next,
  };
}
