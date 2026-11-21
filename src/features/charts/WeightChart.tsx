import { useMemo, useState } from 'react';
import type { AppData } from '@/domain/types';
import { addMonths, dayNumber, formatDate, today } from '@/lib/dates';
import { movingAverage } from '@/lib/math/series';
import { forecastPath } from '@/lib/math/forecast';
import type { Summary } from '@/lib/summary';
import { fmtKg, fmtNum } from '@/lib/format';
import { ChartLegend, LineChart, type ChartSeries } from '@/ui/LineChart';
import { Segmented } from '@/ui/controls';

export type RangeKey = 'D' | 'W' | 'M' | '3M' | '6M' | 'Y' | 'ALL';

export const RANGE_ITEMS: { value: RangeKey; label: string }[] = [
  { value: 'D', label: 'Д' },
  { value: 'W', label: 'Н' },
  { value: 'M', label: 'М' },
  { value: '3M', label: '3М' },
  { value: '6M', label: '6М' },
  { value: 'Y', label: 'Г' },
  { value: 'ALL', label: 'Всё' },
];

export function rangeStart(r: RangeKey, firstDay: number | null, asOf = today()): number {
  const end = dayNumber(asOf);
  switch (r) {
    case 'D':
      return end - 1;
    case 'W':
      return end - 6;
    case 'M':
      return dayNumber(addMonths(asOf, -1));
    case '3M':
      return dayNumber(addMonths(asOf, -3));
    case '6M':
      return dayNumber(addMonths(asOf, -6));
    case 'Y':
      return dayNumber(addMonths(asOf, -12));
    case 'ALL':
      return Math.min(firstDay ?? end - 30, end - 7);
  }
}

/** Weight chart: raw readings, 7-day average, smoothed trend, target and forecast with its uncertainty band. */
export function WeightChart({ data, summary, height = 260, defaultRange = 'M', showForecast = true, compact = false }: { data: AppData; summary: Summary; height?: number; defaultRange?: RangeKey; showForecast?: boolean; compact?: boolean }) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const { points, trend, target, forecast, maintenance } = summary;
  const end = dayNumber(today());
  const from = rangeStart(range, points[0]?.day ?? null);

  const path = useMemo(() => (showForecast && !compact && target != null ? forecastPath(forecast, target, 180) : []), [forecast, target, showForecast]);
  const forecastEnd = path.length ? path[path.length - 1].day : end;
  // show part of the projection after today: up to a third of the visible range
  const to = Math.round(Math.max(end, Math.min(forecastEnd, end + (end - from) * 0.35)));
  const forecastVisible = path.length > 0 && to > end;

  const ma = useMemo(() => movingAverage(points, 7, 3), [points]);
  const series: ChartSeries[] = [
    { id: 'raw', label: 'Измерение', points: points.map((p) => ({ day: p.day, value: p.value })), style: 'dots', color: 'var(--chart-dot)' },
    {
      id: 'ma',
      label: 'Среднее 7 дн.',
      points: points.map((p, i) => (ma[i] == null ? null : { day: p.day, value: ma[i]! })).filter((p): p is { day: number; value: number } => p != null),
      style: 'line',
      color: 'var(--chart-average)',
      breakGapDays: 7,
    },
    { id: 'trend', label: 'Тренд', points: points.map((p, i) => ({ day: p.day, value: trend[i] })), style: 'line', color: 'var(--chart-trend)', breakGapDays: 21 },
  ];
  // the compact chart shows only readings and the trend line
  if (compact) series.splice(1, 1);
  if (path.length) {
    series.push({ id: 'fc', label: 'Прогноз', points: path.map((p) => ({ day: p.day, value: p.value })), style: 'dashed', color: 'var(--chart-forecast)', band: path, tooltip: false });
  }
  const m = data.maintenance?.enabled ? data.maintenance : null;

  const dayEntries = range === 'D' ? data.entries.filter((e) => e.weight != null && e.date === (summary.latest?.date ?? '')) : [];

  return (
    <div className="stack" style={{ ['--gap' as string]: '12px' }}>
      {!compact && <Segmented label="Период графика" items={RANGE_ITEMS} value={range} onChange={setRange} className="range-seg" />}
      {range === 'D' ? (
        <div className="day-view">
          {summary.latest ? (
            <>
              <div className="small muted">Последний день с измерениями — {formatDate(summary.latest.date, { weekday: true })}</div>
              <div className="list">
                {dayEntries.map((e) => (
                  <div key={e.id} className="list-item">
                    <span className="time-pill num">{e.time}</span>
                    <span className="grow num strong">{fmtKg(e.weight!)}</span>
                    {e.note && <span className="small muted">{e.note}</span>}
                  </div>
                ))}
              </div>
              {summary.current != null && (
                <div className="small muted">
                  Сглаженный тренд: <span className="num strong">{fmtKg(summary.current)}</span>. Колебания внутри дня (до 1–2 кг) — норма.
                </div>
              )}
            </>
          ) : (
            <div className="small muted">Нет измерений.</div>
          )}
        </div>
      ) : (
        <>
          <LineChart
            series={series}
            from={from}
            to={to}
            height={height}
            unit="кг"
            ariaLabel="График веса: измерения, средняя за 7 дней, тренд и прогноз"
            target={target != null && !m ? { value: target, label: `Цель ${fmtNum(target, 2)}` } : null}
            range={m && maintenance ? { lo: maintenance.low, hi: maintenance.high, label: 'Диапазон' } : null}
            emptyText="Нет измерений за этот период"
          />
          {!compact && <ChartLegend
            items={[
              { label: 'Измерения', color: 'var(--chart-dot)', style: 'dots' },
              { label: 'Среднее 7 дн.', color: 'var(--chart-average)', style: 'line' },
              { label: 'Тренд', color: 'var(--chart-trend)', style: 'line' },
              ...(forecastVisible ? [{ label: 'Прогноз и диапазон', color: 'var(--chart-forecast)', style: 'dashed' as const }] : []),
            ]}
          />}
        </>
      )}
    </div>
  );
}
