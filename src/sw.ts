/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { openDB } from 'idb';

declare const self: ServiceWorkerGlobalScope;

// Offline: the whole app shell (JS, CSS, fonts, icons) is precached at install.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

const MAX_SNOOZES = 3;
const PUSH_API = ((import.meta.env.VITE_PUSH_API as string | undefined) ?? '').replace(/\/$/, '');
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  reminderId?: string;
  kind?: string;
  sub?: string;
}

// Server push (FORMA push Worker): shown even when the app is closed.
self.addEventListener('push', (event) => {
  let d: PushData = {};
  try {
    d = (event.data?.json() ?? {}) as PushData;
  } catch {
    d = { body: event.data?.text() };
  }
  const actions = d.reminderId
    ? [
        { action: 'enter', title: d.kind === 'weigh' ? 'Внести вес' : 'Открыть' },
        { action: 'skip', title: d.kind === 'weigh' ? 'Сегодня не могу' : 'Не сегодня' },
      ]
    : [];
  event.waitUntil(
    self.registration.showNotification(d.title || 'FORMA', {
      body: d.body ?? '',
      tag: d.tag ?? 'forma',
      icon: 'pwa-192.png',
      badge: 'favicon-64.png',
      data: { url: d.url ?? './#/', reminderId: d.reminderId, sub: d.sub },
      actions,
    } as NotificationOptions),
  );
});

// The browser may rotate the subscription; re-register it with the Worker.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    (async () => {
      if (!PUSH_API || !VAPID_PUBLIC_KEY) return;
      const db = await openDB('forma');
      const settings = (await db.get('kv', 'settings')) as { pushId?: string | null } | undefined;
      db.close();
      if (!settings?.pushId) return;
      const pad = '='.repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
      const raw = atob((VAPID_PUBLIC_KEY + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch(`${PUSH_API}/v1/subscription/endpoint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: settings.pushId, subscription: sub.toJSON() }) });
    })(),
  );
});

async function serverAction(sub: string, reminderId: string, action: 'snooze' | 'skip') {
  await fetch(`${PUSH_API}/v1/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sub, reminderId, action }) });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function updateState(id: string, patch: (s: Record<string, unknown>) => Record<string, unknown>) {
  const db = await openDB('forma');
  try {
    if (!db.objectStoreNames.contains('reminderState')) return null;
    const cur = ((await db.get('reminderState', id)) as Record<string, unknown> | undefined) ?? { id, lastFiredAt: null, snoozedUntil: null, snoozeCount: 0, skipDate: null };
    const next = patch(cur);
    await db.put('reminderState', next);
    return next;
  } finally {
    db.close();
  }
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = (n.data ?? {}) as { url?: string; reminderId?: string; sub?: string };
  n.close();
  const action = event.action;

  if ((action === 'skip' || action === 'snooze') && data.sub && data.reminderId && PUSH_API) {
    event.waitUntil(serverAction(data.sub, data.reminderId, action).catch(() => undefined));
    return;
  }

  if (action === 'skip' && data.reminderId) {
    event.waitUntil(updateState(data.reminderId, (s) => ({ ...s, skipDate: todayISO(), snoozedUntil: null })));
    return;
  }

  if (action === 'snooze' && data.reminderId) {
    // Records the snooze; FORMA re-shows it when due while the app (or its tab) is running.
    // Capped at MAX_SNOOZES per occurrence so a reminder can never repeat endlessly.
    event.waitUntil(
      (async () => {
        const db = await openDB('forma');
        const settings = (await db.get('kv', 'settings')) as { snoozeMinutes?: number } | undefined;
        db.close();
        const minutes = settings?.snoozeMinutes ?? 30;
        await updateState(data.reminderId!, (s) => {
          const count = Number(s.snoozeCount ?? 0);
          return count >= MAX_SNOOZES ? s : { ...s, snoozeCount: count + 1, snoozedUntil: Date.now() + minutes * 60_000 };
        });
      })(),
    );
    return;
  }

  const url = new URL(data.url ?? './#/', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if ('focus' in c) {
          await c.focus();
          if ('navigate' in c) await (c as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
