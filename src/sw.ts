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
  const data = (n.data ?? {}) as { url?: string; reminderId?: string };
  n.close();
  const action = event.action;

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
