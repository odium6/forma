import { getState, saveSettings, subscribe as subscribeStore } from '@/state/store';
import { today } from '@/lib/dates';
import { habitStats, indexLogs } from '@/lib/habits';
import { notificationPermission, requestNotificationPermission } from '@/lib/notify';
import { getDB } from '@/db/db';
import type { Reminder } from '@/domain/types';

/**
 * Background reminders via Web Push. The app subscribes the device with the browser's
 * push service and sends the reminder schedule to the FORMA push Worker, which delivers
 * notifications on time even when the app is closed.
 *
 * Sent to the server: push endpoint + keys, time zone, reminder times/labels/days, quiet
 * hours, motivation flag, and "already done today" markers (no weights, photos or notes).
 */

export const PUSH_API = (import.meta.env.VITE_PUSH_API as string | undefined)?.replace(/\/$/, '') ?? '';
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export function serverPushConfigured(): boolean {
  return !!PUSH_API && !!VAPID_PUBLIC_KEY;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && notificationPermission() !== 'unsupported';
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function api(path: string, method: string, body: unknown): Promise<Response> {
  return fetch(`${PUSH_API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
}

async function currentSubscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing || !create) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) });
}

function payload(id: string, sub: PushSubscription) {
  const s = getState();
  return {
    id,
    subscription: sub.toJSON(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    reminders: s.reminders,
    quietHours: s.settings.quietHours,
    motivation: s.settings.motivation,
    snoozeMinutes: s.settings.snoozeMinutes,
    skipIfDone: s.settings.skipIfDone,
    repeatMinutes: s.settings.repeatMinutes,
  };
}

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'not-configured' | 'not-installed' | 'error';

export async function enableServerPush(): Promise<EnableResult> {
  if (!serverPushConfigured()) return 'not-configured';
  if (!pushSupported()) return 'unsupported';
  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const sub = await currentSubscription(true);
    if (!sub) return 'error';
    const id = getState().settings.pushId ?? randomId();
    const res = await api('/v1/subscription', 'PUT', payload(id, sub));
    if (!res.ok) return 'error';
    await saveSettings({ pushId: id, notificationsEnabled: true });
    lastSynced = JSON.stringify(payload(id, sub));
    return 'ok';
  } catch (e) {
    console.warn('push enable failed', e);
    return 'error';
  }
}

export async function disableServerPush(): Promise<void> {
  const id = getState().settings.pushId;
  try {
    if (id) await api('/v1/subscription', 'DELETE', { id });
    const sub = await currentSubscription(false);
    await sub?.unsubscribe();
  } catch (e) {
    console.warn('push disable failed', e);
  }
  await saveSettings({ pushId: null });
}

export async function sendTestPush(): Promise<boolean> {
  const id = getState().settings.pushId;
  if (!id) return false;
  const res = await api('/v1/test', 'POST', { id });
  return res.ok;
}

let lastSynced = '';
let timer: number | undefined;
const doneSent = new Set<string>();

/** Keeps the server copy of the schedule current and reports "already done today". */
async function sync() {
  const s = getState();
  const id = s.settings.pushId;
  if (!id || !serverPushConfigured() || notificationPermission() !== 'granted') return;
  try {
    const sub = await currentSubscription(true);
    if (!sub) return;
    const body = JSON.stringify(payload(id, sub));
    if (body !== lastSynced) {
      const res = await api('/v1/subscription', 'PUT', JSON.parse(body));
      if (res.ok) lastSynced = body;
    }
    const d = today();
    const idx = indexLogs(s.habitLogs);
    const habits = s.habits.filter((h) => !h.archivedAt).map((h) => habitStats(h, idx, d)).filter((x) => x.todayScheduled);
    const done: Record<string, boolean> = {
      weigh: s.entries.some((e) => e.date === d && e.weight != null),
      photo: s.photos.some((p) => p.date === d),
      habits: habits.length > 0 && habits.every((x) => x.todayDone),
    };
    // each habit separately, so its streak reminder stops repeating once it is marked
    for (const r of s.reminders) {
      if (!r.habitId) continue;
      const h = s.habits.find((x) => x.id === r.habitId);
      if (h) done[`habit:${h.id}`] = habitStats(h, idx, d).todayDone;
    }
    for (const kind of Object.keys(done)) {
      const key = `${kind}|${d}`;
      if (done[kind] && !doneSent.has(key)) {
        const res = await api('/v1/done', 'POST', { id, kind, date: d });
        if (res.ok) doneSent.add(key);
      }
    }
  } catch {
    /* offline: retried on the next change or when the app is opened again */
  }
}

export function startPushSync(): () => void {
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void sync(), 1500);
  };
  const unsub = subscribeStore(schedule);
  const onVis = () => document.visibilityState === 'visible' && schedule();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', schedule);
  schedule();
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', schedule);
  };
}

const SKIP_KEY = 'forma-skip-';

/** "Can't today": stops today's reminders (and their repeats) of this kind, on the server and locally. */
export async function skipToday(kind: Reminder['kind']): Promise<void> {
  const s = getState();
  const d = today();
  try {
    localStorage.setItem(SKIP_KEY + kind, d);
  } catch {
    /* private mode */
  }
  const rems = s.reminders.filter((r) => r.enabled && r.kind === kind);
  const id = s.settings.pushId;
  const db = await getDB();
  for (const r of rems) {
    const st = (await db.get('reminderState', r.id)) ?? { id: r.id, lastFiredAt: null, snoozedUntil: null, snoozeCount: 0, skipDate: null };
    await db.put('reminderState', { ...st, skipDate: d, snoozedUntil: null });
    if (id && serverPushConfigured()) await api('/v1/action', 'POST', { id, reminderId: r.id, action: 'skip' }).catch(() => undefined);
  }
}

export function skippedToday(kind: Reminder['kind']): boolean {
  try {
    return localStorage.getItem(SKIP_KEY + kind) === today();
  } catch {
    return false;
  }
}

/** Link for an iPhone Shortcuts automation ("Пробуждение" / alarm stopped): sends the weighing reminder now. */
export function wakeLink(): string | null {
  const id = getState().settings.pushId;
  return id && PUSH_API ? `${PUSH_API}/v1/wake?id=${id}` : null;
}
