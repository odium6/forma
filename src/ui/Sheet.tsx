import { useEffect, useRef, type ReactNode } from 'react';
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
      <div className="sheet-body">
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
