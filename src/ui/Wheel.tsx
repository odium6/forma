import { useEffect, useRef, type KeyboardEvent } from 'react';
import './wheel.css';

const ITEM = 44;
const VISIBLE = 5;

/**
 * Scroll wheel in the style of the iOS time picker: native scroll + snap, so it feels
 * right with touch, trackpad and mouse wheel. Keyboard: arrows ±1, Page Up/Down ±10.
 */
export function Wheel<T extends number>({
  values,
  value,
  onChange,
  format = String,
  label,
  className = '',
  testId,
}: {
  values: T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  label: string;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, values.indexOf(value));
  const settled = useRef(idx);
  const timer = useRef<number | undefined>(undefined);
  const programmatic = useRef(false);

  const ready = useRef(false);

  // place the wheel on the current value; waits until the sheet is laid out (height > 0)
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      if (el.clientHeight === 0) {
        raf = requestAnimationFrame(place);
        return;
      }
      if (ready.current && settled.current === idx && Math.abs(el.scrollTop - idx * ITEM) < 2) return;
      programmatic.current = true;
      settled.current = idx;
      el.scrollTo({ top: idx * ITEM, behavior: ready.current ? 'smooth' : 'auto' });
      ready.current = true;
      window.clearTimeout(t);
      t = window.setTimeout(() => (programmatic.current = false), 400);
    };
    place();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [idx]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || !ready.current || programmatic.current) return;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM)));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (i !== settled.current) {
        settled.current = i;
        navigator.vibrate?.(4);
        onChange(values[i]);
      }
    }, 90);
  };

  const step = (d: number) => {
    const i = Math.max(0, Math.min(values.length - 1, idx + d));
    if (i !== idx) onChange(values[i]);
  };

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
    if (e.key in map) {
      e.preventDefault();
      step(map[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(values[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(values[values.length - 1]);
    }
  };

  return (
    <div
      ref={ref}
      className={`wheel ${className}`}
      style={{ height: ITEM * VISIBLE, ['--item' as string]: `${ITEM}px` }}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-valuemin={values[0]}
      aria-valuemax={values[values.length - 1]}
      onScroll={onScroll}
      onKeyDown={onKey}
      data-testid={testId}
    >
      <div className="wheel-pad" />
      {values.map((v, i) => (
        <div key={v} className={`wheel-item${i === idx ? ' on' : ''}`} onClick={() => onChange(v)} aria-hidden="true">
          {format(v)}
        </div>
      ))}
      <div className="wheel-pad" />
    </div>
  );
}

const KG = Array.from({ length: 281 }, (_, i) => i + 20);
const FRAC = Array.from({ length: 100 }, (_, i) => i);

/** Weight picker: whole kilograms + hundredths, two wheels side by side. */
export function WeightWheel({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const kg = Math.max(20, Math.min(300, Math.floor(value + 1e-9)));
  const frac = Math.max(0, Math.min(99, Math.round((value - kg) * 100)));
  const set = (k: number, f: number) => onChange(Math.round((k + f / 100) * 100) / 100);
  return (
    <div className="weight-wheel" role="group" aria-label="Вес">
      <div className="wheel-band" aria-hidden="true" />
      <Wheel values={KG} value={kg} onChange={(k) => set(k, frac)} label="Килограммы" className="wheel-kg" testId="wheel-kg" />
      <span className="wheel-sep" aria-hidden="true">,</span>
      <Wheel values={FRAC} value={frac} onChange={(f) => set(kg, f)} format={(f) => String(f).padStart(2, '0')} label="Сотые килограмма" className="wheel-frac" testId="wheel-frac" />
      <span className="wheel-unit" aria-hidden="true">кг</span>
    </div>
  );
}
