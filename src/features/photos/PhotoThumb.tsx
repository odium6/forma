import { useEffect, useRef, useState } from 'react';
import type { PhotoMeta } from '@/domain/types';
import { getPhotoBlob } from '@/state/store';
import './photos.css';

/**
 * Loads a photo blob from IndexedDB only when visible, and revokes its object URL on
 * unmount so large galleries don't leak memory.
 */
export function usePhotoURL(id: string | null, which: 'thumb' | 'blob', enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    let u: string | null = null;
    void getPhotoBlob(id, which).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [id, which, enabled]);
  return url;
}

export function PhotoThumb({ photo, onClick, selected, label }: { photo: PhotoMeta; onClick?: () => void; selected?: boolean; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const url = usePhotoURL(photo.id, 'thumb', visible);
  return (
    <button ref={ref} type="button" className={`thumb ${selected ? 'sel' : ''}`} onClick={onClick} aria-label={label ?? `Фото ${photo.date}`} aria-pressed={selected}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-ph skeleton" />}
    </button>
  );
}
