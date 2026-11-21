import { useEffect, useRef, type ReactNode } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './sheet.css';

/**
 * Modal surface built on the native <dialog> element: focus trapping, Esc and
 * top-layer stacking come from the browser. Bottom sheet on phones, centred dialog on wide screens.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.classList.add('sheet-open');
    }
    if (!open && d.open) d.close();
    return () => {
      if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('sheet-open');
    };
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, []);

  const drag = useSwipeToClose(onClose);

  if (!open) return null;
  const headingId = labelledBy ?? 'sheet-title';
  return createPortal(
    <dialog
      ref={ref}
      className={`sheet sheet-${size}`}
      aria-labelledby={title ? headingId : undefined}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-body" ref={drag.ref} onTouchStart={drag.start} onTouchMove={drag.move} onTouchEnd={drag.end} onTouchCancel={drag.end}>
        <div className="sheet-grip" aria-hidden="true" />
        {title != null && (
          <header className="sheet-head">
            <h2 id={headingId}>{title}</h2>
            <button type="button" className="btn icon sm ghost" onClick={onClose} aria-label="Закрыть">
              <Icon name="close" size={20} />
            </button>
          </header>
        )}
        <div className="sheet-content">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * Pull-down-to-dismiss for the bottom sheet (phones only). The drag starts from the grip or the
 * header, or from the content while it is scrolled to the very top; pickers and fields are excluded.
 */
function useSwipeToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef<{ y: number; t: number; dy: number; active: boolean } | null>(null);

  const start = (e: React.TouchEvent) => {
    const el = ref.current;
    if (!el || e.touches.length !== 1 || !matchMedia('(max-width: 719px)').matches) return;
    const target = e.target as HTMLElement;
    if (target.closest('.wheel, input, textarea, select, [role="slider"], .lg-slider, .cmp-frame')) return;
    const content = el.querySelector('.sheet-content');
    const fromTop = !!target.closest('.sheet-grip, .sheet-head') || !content || content.scrollTop <= 0;
    if (!fromTop) return;
    st.current = { y: e.touches[0].clientY, t: performance.now(), dy: 0, active: false };
  };

  const move = (e: React.TouchEvent) => {
    const s = st.current;
    const el = ref.current;
    if (!s || !el) return;
    const dy = e.touches[0].clientY - s.y;
    if (!s.active) {
      if (dy < -4) {
        st.current = null; // scrolling up: let the content scroll
        return;
      }
      if (dy < 6) return;
      s.active = true;
      el.style.transition = 'none';
    }
    s.dy = Math.max(0, dy);
    el.style.transform = `translateY(${s.dy}px)`;
  };

  const end = () => {
    const s = st.current;
    const el = ref.current;
    st.current = null;
    if (!s || !el || !s.active) return;
    const v = s.dy / Math.max(1, performance.now() - s.t);
    el.style.transition = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    if (s.dy > 120 || (s.dy > 40 && v > 0.6)) {
      el.style.transform = 'translateY(110%)';
      window.setTimeout(onClose, 200);
    } else {
      el.style.transform = '';
    }
  };

  return { ref, start, move, end };
}
