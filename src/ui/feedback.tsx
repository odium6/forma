import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import './feedback.css';

interface Toast {
  id: number;
  text: string;
  tone: 'default' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface ConfirmOpts {
  title: string;
  text?: ReactNode;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  /** Require typing this word to enable confirmation (for irreversible actions). */
  typeToConfirm?: string;
}

interface FeedbackApi {
  toast: (text: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const seq = useRef(0);
  const toastLayer = useRef<HTMLDivElement>(null);

  // Toasts live in a manual popover so they render in the top layer, above open dialogs.
  useEffect(() => {
    const el = toastLayer.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      /* popover unsupported: falls back to a fixed layer */
    }
  }, [toasts]);

  const toast = useCallback<FeedbackApi['toast']>((text, opts) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone: opts?.tone ?? 'default', action: opts?.action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3200);
  }, []);

  const confirm = useCallback<FeedbackApi['confirm']>(
    (o) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setDialog({ ...o, resolve });
      }),
    [],
  );

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const blocked = !!dialog?.typeToConfirm && typed.trim().toLowerCase() !== dialog.typeToConfirm.toLowerCase();

  return (
    <Ctx.Provider value={api}>
      {children}
      <div ref={toastLayer} className="toasts" role="status" aria-live="polite" popover="manual">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'success' && <Icon name="check" size={18} />}
            {t.tone === 'error' && <Icon name="alert" size={18} />}
            <span className="grow">{t.text}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Sheet
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title}
        size="sm"
        labelledBy="confirm-title"
        footer={
          <>
            <button className="btn" onClick={() => close(false)}>
              {dialog?.cancel ?? 'Отмена'}
            </button>
            <button className={`btn ${dialog?.danger ? 'danger' : 'primary'}`} disabled={blocked} onClick={() => close(true)} data-testid="confirm-ok">
              {dialog?.confirm ?? 'Подтвердить'}
            </button>
          </>
        }
      >
        {dialog?.text && <div className="muted">{dialog.text}</div>}
        {dialog?.typeToConfirm && (
          <div className="field">
            <label htmlFor="type-confirm">
              Введи «{dialog.typeToConfirm}», чтобы подтвердить
            </label>
            <input id="type-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
      </Sheet>
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('FeedbackProvider missing');
  return c;
}
