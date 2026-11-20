import { getDB, type ReminderState } from '@/db/db';
import type { Reminder } from '@/domain/types';
import { getState } from '@/state/store';
import { today } from '@/lib/dates';
import { lastOccurrence } from '@/lib/reminders';
import { NOTIFICATION_TEXTS, pick } from '@/lib/insights';
import { habitStats, indexLogs } from '@/lib/habits';

/**
 * Local reminder delivery. Without a push server (FORMA has none by design), the
 * browser can only show reminders while the app or its service worker is running.
 * Missed reminders are caught up once (within LOOKBACK) when the app is opened;
 * each occurrence is shown at most once, plus at most MAX_SNOOZES snoozes.
 */
const LOOKBACK = 3 * 60 * 60 * 1000;
export const MAX_SNOOZES = 3;

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationPermission(): PermissionState {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission as PermissionState;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (notificationPermission() === 'unsupported') return 'unsupported';
  return (await Notification.requestPermission()) as PermissionState;
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Whether a reminder is already pointless today (e.g. weight already logged). */
function alreadyDone(r: Reminder): boolean {
  const s = getState();
  const d = today();
  if (r.kind === 'weigh') return s.entries.some((e) => e.date === d && e.weight != null);
  if (r.kind === 'photo') return s.photos.some((p) => p.date === d);
  if (r.kind === 'habits') {
    const idx = indexLogs(s.habitLogs);
    const active = s.habits.filter((h) => !h.archivedAt).map((h) => habitStats(h, idx, d)).filter((x) => x.todayScheduled);
    return active.length > 0 && active.every((x) => x.todayDone);
  }
  return false;
}

export function reminderBody(r: Reminder, seed: string): string {
  const base = pick([...NOTIFICATION_TEXTS[r.kind]], seed);
  const s = getState();
  if (s.settings.motivation && r.kind !== 'custom') return `${base} ${pick([...NOTIFICATION_TEXTS.motivation], `${seed}m`)}`;
  return r.kind === 'custom' ? r.label : base;
}

export async function showReminder(r: Reminder, tagSuffix = ''): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return false;
  const url = r.kind === 'weigh' ? './#/?entry=1' : r.kind === 'habits' ? './#/habits' : r.kind === 'photo' ? './#/photos' : './#/';
  const opts: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: reminderBody(r, `${r.id}${today()}${tagSuffix}`),
    tag: `forma-${r.id}`,
    icon: 'pwa-192.png',
    badge: 'favicon-64.png',
    data: { url, reminderId: r.id },
    actions: [
      { action: 'enter', title: r.kind === 'weigh' ? 'Внести данные' : 'Открыть' },
      { action: 'snooze', title: 'Отложить' },
      { action: 'skip', title: 'Пропустить сегодня' },
    ],
  };
  await reg.showNotification(r.label || 'FORMA', opts);
  return true;
}

async function tick() {
  const s = getState();
  if (!s.settings.notificationsEnabled || notificationPermission() !== 'granted') return;
  const db = await getDB();
  const now = new Date();
  for (const r of s.reminders.filter((x) => x.enabled)) {
    const st: ReminderState = (await db.get('reminderState', r.id)) ?? { id: r.id, lastFiredAt: null, snoozedUntil: null, snoozeCount: 0, skipDate: null };
    if (st.skipDate === today()) continue;
    if (st.snoozedUntil && st.snoozedUntil <= now.getTime()) {
      await db.put('reminderState', { ...st, snoozedUntil: null, lastFiredAt: now.getTime() });
      if (!alreadyDone(r)) await showReminder(r, `s${st.snoozeCount}`);
      continue;
    }
    const occ = lastOccurrence(r, now, s.settings.quietHours, LOOKBACK);
    if (!occ || (st.lastFiredAt && st.lastFiredAt >= occ.getTime())) continue;
    // mark first: guarantees a single delivery even if two tabs tick together
    await db.put('reminderState', { ...st, lastFiredAt: now.getTime(), snoozeCount: 0, snoozedUntil: null });
    if (!alreadyDone(r)) await showReminder(r);
  }
}

let started = false;

export function startReminderScheduler(): () => void {
  if (started) return () => {};
  started = true;
  const run = () => void tick().catch((e) => console.warn('reminders', e));
  const timer = window.setInterval(run, 30_000);
  const onVis = () => document.visibilityState === 'visible' && run();
  document.addEventListener('visibilitychange', onVis);
  run();
  return () => {
    started = false;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
}
