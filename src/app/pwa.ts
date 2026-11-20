import { useEffect } from 'react';
import { useFeedback } from '@/ui/feedback';

/** Registers the service worker in production and offers a reload when a new version is ready. */
export function useServiceWorker() {
  const { toast } = useFeedback();
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        const offer = (w: ServiceWorker) => {
          if (cancelled) return;
          toast('Доступна новая версия FORMA', {
            action: {
              label: 'Обновить',
              run: () => {
                w.postMessage({ type: 'SKIP_WAITING' });
              },
            },
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
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
    };
  }, [toast]);
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
