import { useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '@/app/Layout';
import { addCustomMetric, deleteCustomMetric, deleteEntry, addEntry, useData } from '@/state/store';
import { computeSummary } from '@/lib/summary';
import { dailySeries, exponentialTrend, linearTrend, mean, pointsBetween, type SeriesKey } from '@/lib/math/series';
import { dayNumber, formatDate, fromDayNumber, today } from '@/lib/dates';
import { fmtKg, fmtNum, fmtSigned } from '@/lib/format';
import { allMetricKeys, metricLabel } from '@/lib/metrics';
import { WeightChart, RANGE_ITEMS, rangeStart, type RangeKey } from '@/features/charts/WeightChart';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { GoalCard } from './GoalCard';
import { ChartLegend, LineChart, type ChartSeries } from '@/ui/LineChart';
import { ChipGroup, EmptyState, Segmented } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import type { AppData, Entry, MeasurementKey } from '@/domain/types';
import './progress.css';

type Tab = 'weight' | 'body' | 'compare' | 'history';

export default function ProgressPage() {
  const data = useData();
  const [tab, setTab] = useState<Tab>('weight');
  return (
    <div className="page">
      <PageHeader title="Прогресс" />
      <Segmented
        label="Раздел прогресса"
        value={tab}
        onChange={setTab}
        className="tabs-seg"
        items={[
          { value: 'weight', label: 'Вес' },
          { value: 'body', label: 'Тело' },
          { value: 'compare', label: 'Сравнение' },
          { value: 'history', label: 'История' },
        ]}
      />
      {tab === 'weight' && <WeightTab data={data} />}
      {tab === 'body' && <BodyTab data={data} />}
      {tab === 'compare' && <CompareTab data={data} />}
      {tab === 'history' && <HistoryTab data={data} />}
    </div>
  );
}

function WeightTab({ data }: { data: AppData }) {
  const s = useMemo(() => computeSummary(data), [data]);
  const asOf = s.latest?.date ?? today();
  const t14 = linearTrend(s.points, asOf, 14, { minPoints: 4, minSpanDays: 7 });
  const t30 = linearTrend(s.points, asOf, 30, { minPoints: 6, minSpanDays: 14 });
  const t90 = linearTrend(s.points, asOf, 90, { minPoints: 10, minSpanDays: 45 });
  const values = s.points.map((p) => p.value);
  const last7 = pointsBetween(s.points, fromDayNumber(dayNumber(asOf) - 6), asOf).map((p) => p.value);

  if (!s.points.length) return <EmptyState icon="scale" title="Пока нет измерений" text="Внеси вес, чтобы увидеть графики и тренды." />;

  return (
    <div className="dash">
      <div className="col">
        <section className="card">
          <WeightChart data={data} summary={s} height={320} defaultRange="3M" />
        </section>
        <section className="card">
          <div className="card-head"><h2>Тренды</h2></div>
          <div className="trend-groups">
            <TrendGroup title="Краткосрочно">
              <TrendRow label="Среднее за 7 дней" value={last7.length >= 3 ? fmtKg(mean(last7)) : null} need="нужно 3 измерения за неделю" />
              <TrendRow label="Темп за 14 дней" value={t14 ? `${fmtSigned(t14.slope * 7, 2)} кг/нед` : null} need="нужно 4 измерения за 7+ дней" />
            </TrendGroup>
            <TrendGroup title="Среднесрочно">
              <TrendRow label="Темп за 30 дней" value={t30 ? `${fmtSigned(t30.slope * 7, 2)} кг/нед` : null} need="нужно 6 измерений за 14+ дней" />
              <TrendRow label="Изменение тренда за 30 дней" value={s.change30 != null ? fmtSigned(s.change30, 2, 'кг') : null} need="нужно больше данных за месяц" />
            </TrendGroup>
            <TrendGroup title="Долгосрочно">
              <TrendRow label="Темп за 90 дней" value={t90 ? `${fmtSigned(t90.slope * 30, 2)} кг/мес` : null} need="нужно 10 измерений за 45+ дней" />
              <TrendRow label="Минимум" value={fmtKg(Math.min(...values))} hint={formatDate(s.points[values.indexOf(Math.min(...values))].date)} />
              <TrendRow label="Максимум" value={fmtKg(Math.max(...values))} hint={formatDate(s.points[values.indexOf(Math.max(...values))].date)} />
            </TrendGroup>
          </div>
        </section>
      </div>
      <div className="col">
        <GoalCard data={data} summary={s} />
      </div>
    </div>
  );
}

function TrendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="trend-group">
      <div className="group-title">{title}</div>
      <div className="list">{children}</div>
    </div>
  );
}

function TrendRow({ label, value, hint, need }: { label: string; value: string | null; hint?: string; need?: string }) {
  return (
    <div className="list-item trend-row">
      <span className="list-text">
        <span>{label}</span>
        {(hint || (value == null && need)) && <span className="list-sub">{value == null ? need : hint}</span>}
      </span>
      <span className={`num strong ${value == null ? 'faint' : ''}`}>{value ?? 'мало данных'}</span>
    </div>
  );
}

function BodyTab({ data }: { data: AppData }) {
  const { toast, confirm } = useFeedback();
  const openEntry = useOpenEntry();
  const keys: SeriesKey[] = ['bodyFat', ...allMetricKeys(data.customMetrics)];
  const withData = keys.filter((k) => dailySeries(data.entries, k).length > 0);
  const [key, setKey] = useState<SeriesKey>(withData[0] ?? 'waist');
  const [range, setRange] = useState<RangeKey>('ALL');
  const [adding, setAdding] = useState(false);
  const label = (k: SeriesKey) => (k === 'bodyFat' ? { label: 'Процент жира', unit: '%' } : metricLabel(k, data.customMetrics));
  const pts = dailySeries(data.entries, key);
  const trend = exponentialTrend(pts, 0.25);
  const from = rangeStart(range === 'D' ? 'W' : range, pts[0]?.day ?? null);
  const visible = pts.filter((p) => p.day >= from);
  const { unit } = label(key);
  const goal = [...data.goals].reverse().find((g) => g.status === 'active');
  const targetVal = key === 'bodyFat' ? goal?.targetBodyFat : key !== 'weight' ? goal?.targetMeasurements[key as keyof typeof goal.targetMeasurements] : null;
  const change = visible.length > 1 ? visible[visible.length - 1].value - visible[0].value : null;
  const custom = key.startsWith('custom:') ? data.customMetrics.find((c) => `custom:${c.id}` === key) : null;

  return (
    <div className="stack">
      {withData.length > 0 && (
        <section className="card tight">
          <div className="body-head" aria-hidden="true">
            <span>Параметр</span>
            <span>Первое</span>
            <span>Сейчас</span>
            <span>Изм.</span>
          </div>
          <div className="list" role="list" aria-label="Параметры тела">
            {withData.map((k) => {
              const ps = dailySeries(data.entries, k);
              const first = ps[0].value;
              const last = ps[ps.length - 1].value;
              const u = label(k).unit;
              return (
                <button key={k} role="listitem" className={`list-item body-row${k === key ? ' on' : ''}`} aria-pressed={k === key} onClick={() => setKey(k)}>
                  <span className="body-name">{label(k).label}</span>
                  <span className="num faint">{fmtNum(first, 2)}</span>
                  <span className="num strong">{fmtNum(last, 2)}</span>
                  <span className="num body-delta">{ps.length > 1 ? fmtSigned(last - first, 2, u) : '—'}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="card">
        {withData.length === 0 && (
          <ChipGroup label="Параметр" value={key} onChange={(v) => setKey(v as SeriesKey)} options={keys.map((k) => ({ value: k, label: label(k).label }))} />
        )}
        <div className="row between wrap">
          <div>
            <h2>{label(key).label}</h2>
            {visible.length > 0 ? (
              <p className="small muted">
                Последнее: <span className="num strong">{fmtNum(pts[pts.length - 1].value, 2)} {unit}</span>
                {change != null && <> · за период <span className="num strong">{fmtSigned(change, 2, unit)}</span></>}
              </p>
            ) : (
              <p className="small muted">Нет данных за период</p>
            )}
          </div>
        </div>
        <Segmented label="Период" value={range} onChange={setRange} items={RANGE_ITEMS.filter((r) => r.value !== 'D')} className="range-seg" />
        {pts.length ? (
          <>
            <LineChart
              ariaLabel={`График: ${label(key).label}`}
              from={from}
              to={dayNumber(today())}
              unit={unit}
              height={280}
              target={targetVal != null ? { value: targetVal, label: `Цель ${fmtNum(targetVal, 2)}` } : null}
              series={[
                { id: 'raw', label: 'Измерение', points: pts, style: 'dots', color: 'var(--chart-dot)' },
                ...(pts.length >= 3 ? [{ id: 'trend', label: 'Тренд', points: pts.map((p, i) => ({ day: p.day, value: trend[i] })), style: 'line' as const, color: 'var(--chart-trend)', breakGapDays: 45 }] : []),
              ]}
            />
            <ChartLegend items={[{ label: 'Измерения', color: 'var(--chart-dot)', style: 'dots' }, ...(pts.length >= 3 ? [{ label: 'Тренд', color: 'var(--chart-trend)', style: 'line' as const }] : [])]} />
          </>
        ) : (
          <EmptyState icon="ruler" title="Нет измерений" text="Добавь значение во время следующего внесения данных." action={<button className="btn primary" onClick={() => openEntry({ focus: 'measurements' })}>Внести измерения</button>} />
        )}
      </section>
      {pts.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Значения</h2></div>
          <div className="list">
            {[...data.entries]
              .filter((e) => (key === 'bodyFat' ? e.bodyFat != null : e.measurements[key as MeasurementKey] != null))
              .reverse()
              .slice(0, 30)
              .map((e) => (
                <button key={e.id} className="list-item" onClick={() => openEntry({ entryId: e.id })} aria-label={`Изменить запись от ${formatDate(e.date)}`}>
                  <span className="grow">{formatDate(e.date, { year: true })}</span>
                  <span className="num strong">{fmtNum(key === 'bodyFat' ? e.bodyFat! : e.measurements[key as MeasurementKey]!, 2)} {unit}</span>
                  <Icon name="edit" size={16} className="chev" />
                </button>
              ))}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-head">
          <h2>Свои параметры</h2>
          <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Добавить</button>
        </div>
        {data.customMetrics.length === 0 ? (
          <p className="small muted">Например: обхват под грудью, запястье, давление или любой другой показатель.</p>
        ) : (
          <div className="list">
            {data.customMetrics.map((m) => (
              <div key={m.id} className="list-item">
                <span className="grow">{m.name} <span className="faint small">({m.unit || 'без единиц'})</span></span>
                <button
                  className="btn icon sm ghost"
                  aria-label={`Удалить параметр ${m.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Удалить «${m.name}»?`, text: 'Параметр исчезнет из форм и графиков. Уже внесённые значения останутся в истории и резервных копиях.', danger: true, confirm: 'Удалить' })) {
                      await deleteCustomMetric(m.id);
                      if (custom?.id === m.id) setKey('waist');
                    }
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <AddMetricSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={async (name, unit) => {
          const m = await addCustomMetric(name, unit, null);
          setKey(`custom:${m.id}`);
          toast(`Параметр «${name}» добавлен`, { tone: 'success' });
        }}
      />
    </div>
  );
}

function AddMetricSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string, unit: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('см');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Новый параметр"
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={async () => {
              await onAdd(name.trim(), unit.trim());
              setName('');
              onClose();
            }}
          >
            Добавить
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="m-name">Название</label>
        <input id="m-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="m-unit">Единица измерения</label>
        <input id="m-unit" className="input" maxLength={12} value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
    </Sheet>
  );
}

const COMPARE_COLORS = ['var(--chart-trend)', 'var(--chart-series-2)', 'var(--chart-series-3)', 'var(--chart-series-4)', 'var(--warning)', 'var(--chart-average)'];

function CompareTab({ data }: { data: AppData }) {
  const keys = (['weight', 'bodyFat', ...allMetricKeys(data.customMetrics)] as SeriesKey[]).filter((k) => dailySeries(data.entries, k).length > 1);
  const [sel, setSel] = useState<SeriesKey[]>(keys.slice(0, 3));
  const [range, setRange] = useState<RangeKey>('ALL');
  const label = (k: SeriesKey) => (k === 'weight' ? 'Вес' : k === 'bodyFat' ? 'Процент жира' : metricLabel(k, data.customMetrics).label);
  const firstDay = Math.min(...sel.map((k) => dailySeries(data.entries, k)[0]?.day ?? Infinity));
  const from = rangeStart(range === 'D' ? 'W' : range, Number.isFinite(firstDay) ? firstDay : null);

  // Different units can't share an axis, so each parameter is shown as % change from its first value in the range.
  const series: ChartSeries[] = sel.map((k, i) => {
    const pts = dailySeries(data.entries, k).filter((p) => p.day >= from);
    const base = pts[0]?.value ?? 1;
    return { id: k, label: label(k), points: pts.map((p) => ({ day: p.day, value: ((p.value - base) / base) * 100 })), style: 'line', color: COMPARE_COLORS[i % COMPARE_COLORS.length], breakGapDays: 60, digits: 1 };
  });

  if (keys.length < 2) return <EmptyState icon="compare" title="Пока нечего сравнивать" text="Сравнение появится, когда хотя бы у двух параметров будет минимум два измерения." />;

  return (
    <section className="card stack">
      <ChipGroup label="Параметры для сравнения" multiple value={sel} onChange={(v) => setSel((v as SeriesKey[]).slice(0, 6))} options={keys.map((k) => ({ value: k, label: label(k) }))} />
      <Segmented label="Период" value={range} onChange={setRange} items={RANGE_ITEMS.filter((r) => r.value !== 'D')} className="range-seg" />
      <LineChart ariaLabel="Сравнение изменения параметров в процентах" from={from} to={dayNumber(today())} unit="%" height={300} series={series} formatValue={(v) => `${fmtSigned(v, 2)}%`} />
      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, style: 'line' }))} />
      <p className="small muted">Каждая линия — изменение параметра в процентах от первого значения в выбранном периоде. Так вес и обхваты можно сравнивать на одной шкале.</p>
      <div className="table-wrap">
        <table className="table cmp-table">
          <thead>
            <tr>
              <th>Параметр</th>
              <th className="num-col">Начало</th>
              <th className="num-col">Сейчас</th>
              <th className="num-col">Изменение</th>
            </tr>
          </thead>
          <tbody>
            {sel.map((k, i) => {
              const pts = dailySeries(data.entries, k).filter((p) => p.day >= from);
              if (pts.length < 2) return null;
              const a = pts[0].value;
              const b = pts[pts.length - 1].value;
              const unit = k === 'weight' ? 'кг' : k === 'bodyFat' ? '%' : metricLabel(k, data.customMetrics).unit;
              const d = b - a;
              return (
                <tr key={k}>
                  <td><span className="cmp-swatch" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} /> {label(k)}</td>
                  <td className="num num-col">{fmtNum(a, 2)}</td>
                  <td className="num num-col strong">{fmtNum(b, 2)}</td>
                  <td className="num num-col">
                    <span className="dir" aria-hidden="true">{Math.abs(d) < 0.005 ? '→' : d < 0 ? '↓' : '↑'}</span> {fmtSigned(d, 2, unit)}
                    <span className="faint xs"> ({fmtSigned((d / a) * 100, 2)}%)</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryTab({ data }: { data: AppData }) {
  const openEntry = useOpenEntry();
  const { confirm, toast } = useFeedback();
  const [limit, setLimit] = useState(90);
  const rows = [...data.entries].reverse();
  const measLabel = (e: Entry) =>
    [e.bodyFat != null ? `жир ${fmtNum(e.bodyFat, 2)}%` : '', ...Object.entries(e.measurements).map(([k, v]) => `${metricLabel(k, data.customMetrics).label.toLowerCase()} ${fmtNum(v!, 2)}`)]
      .filter(Boolean)
      .join(' · ');

  if (!rows.length) return <EmptyState icon="note" title="История пуста" text="Здесь появятся все внесённые записи." />;

  const remove = async (e: Entry) => {
    if (!(await confirm({ title: 'Удалить запись?', text: `${formatDate(e.date)}, ${e.time}`, danger: true, confirm: 'Удалить' }))) return;
    await deleteEntry(e.id);
    toast('Запись удалена', { action: { label: 'Вернуть', run: () => void addEntry({ date: e.date, time: e.time, weight: e.weight, bodyFat: e.bodyFat, measurements: e.measurements, note: e.note, source: e.source }) } });
  };

  const groups: { month: string; items: Entry[] }[] = [];
  for (const e of rows.slice(0, limit)) {
    const m = e.date.slice(0, 7);
    if (groups[groups.length - 1]?.month !== m) groups.push({ month: m, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const monthTitle = (m: string) => {
    const t = new Date(`${m}-15T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return (
    <div className="stack history">
      <p className="small muted">Записей: <span className="num strong">{rows.length}</span></p>
      {groups.map((g) => (
        <section key={g.month} className="section">
          <h2 className="group-title">{monthTitle(g.month)}</h2>
          <div className="group" role="list">
            {g.items.map((e) => {
              const extra = measLabel(e);
              return (
                <div key={e.id} className="list-item hist-row" role="listitem" data-testid="history-row">
                  <button className="hist-main" onClick={() => openEntry({ entryId: e.id })} aria-label={`Открыть запись от ${formatDate(e.date)}, ${e.time}`}>
                    <span className="hist-date">
                      <span className="strong">{formatDate(e.date)}</span>
                      <span className="xs faint num">{e.time}</span>
                    </span>
                    <span className="list-text">
                      <span className="num strong">{e.weight != null ? fmtKg(e.weight) : e.note ? 'Заметка' : '—'}</span>
                      {(extra || e.note) && <span className="list-sub hist-extra">{[extra, e.note].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </button>
                  <button className="btn icon sm ghost" aria-label="Изменить" onClick={() => openEntry({ entryId: e.id })}>
                    <Icon name="edit" size={17} />
                  </button>
                  <button className="btn icon sm ghost" aria-label="Удалить" onClick={() => remove(e)}>
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {rows.length > limit && (
        <button className="btn block" onClick={() => setLimit(limit + 150)}>
          Показать ещё
        </button>
      )}
    </div>
  );
}
