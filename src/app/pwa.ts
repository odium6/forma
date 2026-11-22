import { useEffect } from 'react';
import { useFeedback } from '@/ui/feedback';

const SEEN_KEY = 'forma-version';

/**
 * Registers the service worker in production and keeps the app current:
 * checks for a new version on launch, when the app comes back to the foreground and every minute,
 * then switches to it right away (unless a form is open — then it offers a button).
 */
export function useServiceWorker() {
  const { toast } = useFeedback();
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let timer = 0;

    // tell the user once that the app was updated
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (seen && seen !== __APP_VERSION__) toast(`FORMA обновлена до версии ${__APP_VERSION__}`, { tone: 'success' });
      localStorage.setItem(SEEN_KEY, __APP_VERSION__);
    } catch {
      /* private mode */
    }

    const apply = (w: ServiceWorker) => {
      if (cancelled) return;
      const busy = !!document.querySelector('dialog[open]');
      if (!busy) {
        w.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      toast('Готова новая версия FORMA', { sticky: true, action: { label: 'Обновить', run: () => w.postMessage({ type: 'SKIP_WAITING' }) } });
    };

    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) apply(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) apply(w);
          });
        });
        const check = () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        };
        check();
        timer = window.setInterval(check, 60_000);
        document.addEventListener('visibilitychange', check);
        window.addEventListener('online', check);
      })
      .catch((e) => console.warn('SW registration failed', e));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [toast]);
}

/** Latest published version (from version.json, bypassing caches); null when offline. */
export async function latestVersion(): Promise<string | null> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return ((await r.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Asks the browser to keep IndexedDB from being evicted under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}
