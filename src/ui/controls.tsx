import { useId, useState, type ReactNode } from 'react';
import { SegmentedControl, Switch } from 'glisse';
import { parseDecimal } from '@/lib/format';
import { Icon, type IconName } from './Icon';

/** Decimal input that accepts both "," and "." and validates against a range. */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  hint,
  big,
  placeholder,
  autoFocus,
  testId,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  min?: number;
  max?: number;
  hint?: ReactNode;
  big?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  testId?: string;
  required?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const n = parseDecimal(value);
  let error: string | null = null;
  if (value.trim() !== '') {
    if (n == null) error = 'Введите число';
    else if (min != null && n < min) error = `Не меньше ${min}`;
    else if (max != null && n > max) error = `Не больше ${max}`;
  } else if (required && touched) error = 'Обязательное поле';
  return (
    <div className="field">
      <label htmlFor={id} className={big ? 'sr-only' : undefined}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          id={id}
          className={`input num${big ? ' big' : ''}`}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={!!error && touched}
          data-testid={testId}
          onBlur={() => setTouched(true)}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {error && touched ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function fieldValid(value: string, min: number, max: number, required = false): boolean {
  if (value.trim() === '') return !required;
  const n = parseDecimal(value);
  return n != null && n >= min && n <= max;
}

/** Liquid Glass segmented control (Glisse). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`seg-wrap ${className ?? ''}`}>
      <SegmentedControl aria-label={label} className="f-segmented" items={items} value={value} onValueChange={(v) => onChange(v as T)} />
    </div>
  );
}

/** Settings-style row with a Glisse switch. */
export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  icon,
  disabled,
}: {
  title: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: IconName;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="list-item">
      {icon && (
        <span className="list-icon">
          <Icon name={icon} size={19} />
        </span>
      )}
      <div className="grow">
        <div id={id} className="strong">
          {title}
        </div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <Switch aria-labelledby={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  label,
  multiple,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | T[];
  onChange: (v: T | T[]) => void;
  label: string;
  multiple?: boolean;
}) {
  const selected = Array.isArray(value) ? value : [value];
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            type="button"
            key={String(o.value)}
            className="chip"
            aria-pressed={on}
            onClick={() => {
              if (!multiple) onChange(o.value);
              else onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value]);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressRing({ value, size = 168, stroke = 14, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--lime)" />
            <stop offset="1" stopColor="var(--green)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 900ms var(--ease)' }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'positive'; children: ReactNode; icon?: IconName }) {
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'positive' ? 'check' : tone === 'info' ? 'info' : 'alert')} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {text && <p className="small" style={{ maxWidth: 360 }}>{text}</p>}
      {action}
    </div>
  );
}
