import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { formatDateShort, formatMonthShort, fromDayNumber } from '@/lib/dates';
import { fmtNum } from '@/lib/format';
import './chart.css';

export interface ChartPoint {
  day: number;
  value: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  points: ChartPoint[];
  /** dots = raw measurements; line = smoothed; dashed = forecast. */
  style: 'dots' | 'line' | 'dashed';
  color: string;
  /** Do not connect points further apart than this (no invented values across gaps). */
  breakGapDays?: number;
  band?: { day: number; lo: number; hi: number }[];
  /** Included in the tooltip. */
  tooltip?: boolean;
  digits?: number;
}

export interface ChartProps {
  series: ChartSeries[];
  from: number;
  to: number;
  height?: number;
  unit?: string;
  target?: { value: number; label: string } | null;
  range?: { lo: number; hi: number; label: string } | null;
  ariaLabel: string;
  emptyText?: string;
  formatValue?: (v: number) => string;
}

function niceStep(span: number, count: number) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function xTicks(from: number, to: number, width: number): { day: number; label: string }[] {
  const span = to - from;
  const maxTicks = Math.max(2, Math.floor(width / 72));
  if (span > 120) {
    const out: { day: number; label: string }[] = [];
    const step = Math.ceil(span / 30 / maxTicks);
    let d = fromDayNumber(from);
    let [y, m] = d.split('-').map(Number);
    for (let i = 0; i < 40; i++) {
      m += i === 0 ? 1 : step;
      while (m > 12) { m -= 12; y++; }
      d = `${y}-${String(m).padStart(2, '0')}-01`;
      const day = Math.round(Date.UTC(y, m - 1, 1) / 86_400_000);
      if (day > to) break;
      out.push({ day, label: formatMonthShort(d) });
    }
    return out;
  }
  const step = Math.max(1, Math.ceil(span / maxTicks));
  const out: { day: number; label: string }[] = [];
  for (let d = to; d >= from; d -= step) out.unshift({ day: d, label: formatDateShort(fromDayNumber(d)) });
  return out;
}

function pathFor(pts: ChartPoint[], x: (d: number) => number, y: (v: number) => number, gap: number): string {
  let s = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const brk = i === 0 || p.day - pts[i - 1].day > gap;
    s += `${brk ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`;
  }
  return s;
}

export function LineChart({ series, from, to, height = 240, unit = '', target, range, ariaLabel, emptyText = 'Нет данных за этот период', formatValue }: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = formatValue ?? ((v: number) => `${fmtNum(v, 2)}${unit ? ` ${unit}` : ''}`);
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;

  const visible = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: s.points.filter((p) => p.day >= from - (s.style === 'dots' ? 0 : 3) && p.day <= to),
        band: s.band?.filter((b) => b.day >= from && b.day <= to),
      })),
    [series, from, to],
  );

  const values = visible.flatMap((s) => [...s.points.map((p) => p.value), ...(s.band ?? []).flatMap((b) => [b.lo, b.hi])]);
  const hasData = visible.some((s) => s.points.length > 0);
  if (range) values.push(range.lo, range.hi);
  const dataLo = values.length ? Math.min(...values) : 0;
  const dataHi = values.length ? Math.max(...values) : 1;
  // A far-away target would flatten the data; then it is shown as an edge marker instead.
  const span = Math.max(1, dataHi - dataLo);
  const targetInScale = !!target && (!values.length || (target.value >= dataLo - span * 1.2 && target.value <= dataHi + span * 1.2));
  if (target && targetInScale) values.push(target.value);
  let lo = values.length ? Math.min(...values) : (target?.value ?? 0) - 1;
  let hi = values.length ? Math.max(...values) : (target?.value ?? 0) + 1;
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(Number(v.toFixed(6)));

  const x = (d: number) => pad.l + ((d - from) / Math.max(1, to - from)) * innerW;
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * innerH;

  const tipSeries = visible.filter((s) => s.tooltip !== false && s.points.length);
  const anchor = visible.find((s) => s.style === 'dots' && s.points.length) ?? tipSeries[0];

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!anchor) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = from + ((e.clientX - rect.left - pad.l) / innerW) * (to - from);
    let best: ChartPoint | null = null;
    for (const s of tipSeries) for (const p of s.points) if (!best || Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
    setHover(best ? best.day : null);
  };

  const tip = hover != null
    ? tipSeries
        .map((s) => {
          const p = s.points.find((q) => q.day === hover);
          return p ? { s, p } : null;
        })
        .filter((v): v is { s: (typeof visible)[number]; p: ChartPoint } => v != null)
    : [];

  const tipX = hover != null ? x(hover) : 0;
  const tipLeft = Math.min(Math.max(tipX - 80, 4), Math.max(4, width - 164));

  return (
    <div className="chart" ref={wrap} style={{ height }}>
      {!hasData && <div className="chart-empty">{emptyText}</div>}
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={pad.l - 8} y={y(v)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
                {fmtNum(v, step < 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {xTicks(from, to, innerW).map((t) => (
            <text key={t.day} x={x(t.day)} y={height - 6} className="chart-axis" textAnchor="middle">
              {t.label}
            </text>
          ))}
          {range && (
            <g>
              <rect x={pad.l} width={innerW} y={y(range.hi)} height={Math.max(0, y(range.lo) - y(range.hi))} className="chart-range" />
              <text x={width - pad.r - 4} y={y(range.hi) - 5} className="chart-label" textAnchor="end">{range.label}</text>
            </g>
          )}
          {target && !targetInScale && (
            <text x={width - pad.r - 4} y={target.value < lo ? pad.t + innerH - 6 : pad.t + 10} className="chart-label target" textAnchor="end">
              {target.label} {target.value < lo ? '↓' : '↑'}
            </text>
          )}
          {target && targetInScale && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={y(target.value)} y2={y(target.value)} className="chart-target" />
              <text x={width - pad.r - 4} y={y(target.value) - 6} className="chart-label target" textAnchor="end">{target.label}</text>
            </g>
          )}
          {visible.map((s) =>
            s.band && s.band.length > 1 ? (
              <path
                key={`${s.id}-band`}
                d={`${s.band.map((b, i) => `${i ? 'L' : 'M'}${x(b.day).toFixed(1)},${y(b.hi).toFixed(1)}`).join('')}${[...s.band].reverse().map((b) => `L${x(b.day).toFixed(1)},${y(b.lo).toFixed(1)}`).join('')}Z`}
                className="chart-band"
              />
            ) : null,
          )}
          {visible.map((s) =>
            s.style === 'dots' ? (
              <g key={s.id} style={{ color: s.color }}>
                {s.points.map((p) => (
                  <circle key={p.day} cx={x(p.day)} cy={y(p.value)} r={s.points.length > 120 ? 2 : 3.2} className="chart-dot" />
                ))}
              </g>
            ) : (
              <path key={s.id} d={pathFor(s.points, x, y, s.breakGapDays ?? 14)} className={`chart-line ${s.style}`} style={{ stroke: s.color }} />
            ),
          )}
          {hover != null && tip.length > 0 && (
            <g>
              <line x1={tipX} x2={tipX} y1={pad.t} y2={pad.t + innerH} className="chart-cursor" />
              {tip.map(({ s, p }) => (
                <circle key={s.id} cx={x(p.day)} cy={y(p.value)} r={5} className="chart-hl" style={{ stroke: s.color }} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover != null && tip.length > 0 && (
        <div className="chart-tip" style={{ left: tipLeft }} aria-live="polite">
          <div className="chart-tip-date">{formatDateShort(fromDayNumber(hover))}</div>
          {tip.map(({ s, p }) => (
            <div key={s.id} className="chart-tip-row">
              <span className="chart-swatch" style={{ background: s.color }} />
              <span className="grow">{s.label}</span>
              <span className="num strong">{s.digits != null ? `${fmtNum(p.value, s.digits)}${unit ? ` ${unit}` : ''}` : fmt(p.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; style: 'dots' | 'line' | 'dashed' | 'band' }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label} className={`legend-item ${i.style}`}>
          <span className="legend-mark" style={{ color: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
