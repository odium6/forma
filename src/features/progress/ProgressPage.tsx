import { useMemo, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import { addCustomMetric, deleteCustomMetric, deleteEntry, addEntry, useData } from '@/state/store';
import { computeSummary } from '@/lib/summary';
import { dailySeries, exponentialTrend, linearTrend, mean, pointsBetween, type SeriesKey } from '@/lib/math/series';
import { dayNumber, formatDate, fromDayNumber, today } from '@/lib/dates';
import { fmtKg, fmtNum, fmtSigned, nDays } from '@/lib/format';
import { allMetricKeys, metricLabel } from '@/lib/metrics';
import { WeightChart, RANGE_ITEMS, rangeStart, type RangeKey } from '@/features/charts/WeightChart';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { GoalCard } from './GoalCard';
import { ChartLegend, LineChart, type ChartSeries } from '@/ui/LineChart';
import { ChipGroup, EmptyState, Segmented } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import type { AppData, Entry } from '@/domain/types';
import './progress.css';

type Tab = 'weight' | 'body' | 'compare' | 'history';

export default function ProgressPage() {
  const data = useData();
  const [tab, setTab] = useState<Tab>('weight');
  return (
    <div className="page">
      <PageHeader title="Прогресс" subtitle="Вес, тело и вся история измерений" />
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
  const f = s.forecast;

  if (!s.points.length) return <EmptyState icon="scale" title="Пока нет измерений" text="Внеси вес, чтобы увидеть графики и тренды." />;

  return (
    <div className="dash">
      <div className="col">
        <section className="card">
          <WeightChart data={data} summary={s} height={320} defaultRange="3M" />
        </section>
        <section className="card">
          <div className="card-head"><h2>Тренды</h2></div>
          <div className="stat-grid">
            <Stat label="Среднее за 7 дней" value={last7.length >= 3 ? fmtKg(mean(last7)) : null} hint={last7.length >= 3 ? `${last7.length} измер.` : 'нужно ≥ 3 измерений'} />
            <Stat label="Тренд 14 дней" value={t14 ? `${fmtSigned(t14.slope * 7, 2)} кг/нед` : null} hint={t14 ? `${t14.n} измер.` : 'мало данных'} />
            <Stat label="Тренд 30 дней" value={t30 ? `${fmtSigned(t30.slope * 7, 2)} кг/нед` : null} hint={t30 ? `${t30.n} измер.${t30.outliersRemoved ? `, ${t30.outliersRemoved} выброс исключён` : ''}` : 'мало данных'} />
            <Stat label="Долгосрочно (90 дн.)" value={t90 ? `${fmtSigned(t90.slope * 30, 1)} кг/мес` : null} hint={t90 ? `${t90.n} измер.` : 'нужно 45+ дней наблюдений'} />
            <Stat label="Минимум" value={fmtKg(Math.min(...values))} hint={formatDate(s.points[values.indexOf(Math.min(...values))].date)} />
            <Stat label="Максимум" value={fmtKg(Math.max(...values))} hint={formatDate(s.points[values.indexOf(Math.max(...values))].date)} />
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            Тренд — экспоненциальное сглаживание с учётом пропусков; темп — устойчивая линейная регрессия, которая исключает единичные выбросы. Выводы по двум последним измерениям не делаются.
          </p>
        </section>
      </div>
      <div className="col">
        <GoalCard data={data} summary={s} />
        <section className="card">
          <div className="card-head"><h2>Как считается прогноз</h2></div>
          <div className="stack small" style={{ ['--gap' as string]: '10px' }}>
            {f.fit ? (
              <>
                <p>
                  Последние 28 дней: <span className="num strong">{f.fit.n}</span> дней с измерениями, разброс вокруг тренда ±<span className="num">{fmtNum(f.fit.residualSD, 2)}</span> кг.
                </p>
                <p>
                  Темп: <span className="num strong">{fmtSigned(f.kgPerWeek!, 2)} кг/нед</span> ({fmtNum(f.pctPerWeek!, 2)}% веса). Диапазон дат учитывает статистическую погрешность темпа и то, что темп со временем меняется (±20%).
                </p>
              </>
            ) : (
              <p>Для прогноза нужно минимум 6 дней с измерениями за 10+ дней. {f.needPoints > 0 && `Ещё ${f.needPoints} измер.`} {f.needSpanDays > 0 && `Ещё ${nDays(f.needSpanDays)} наблюдений.`}</p>
            )}
            <p className="muted">Вес колеблется на 0,5–2 кг из‑за воды, соли, углеводов, времени взвешивания и нагрузки. Поэтому прогресс и прогноз считаются по сглаженному тренду, а не по последнему значению.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${value == null ? 'faint' : ''}`}>{value ?? '—'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
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
      <section className="card">
        <ChipGroup
          label="Параметр"
          value={key}
          onChange={(v) => setKey(v as SeriesKey)}
          options={keys.map((k) => ({ value: k, label: withData.includes(k) ? label(k).label : <span style={{ opacity: 0.55 }}>{label(k).label}</span> }))}
        />
        <div className="row between wrap" style={{ marginTop: 16 }}>
          <div>
            <h2>{label(key).label}</h2>
            {visible.length > 0 ? (
              <p className="small muted">
                Последнее: <span className="num strong">{fmtNum(pts[pts.length - 1].value, 1)} {unit}</span>
                {change != null && <> · за период <span className="num strong">{fmtSigned(change, 1, unit)}</span></>}
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
              target={targetVal != null ? { value: targetVal, label: `Цель ${fmtNum(targetVal, 1)}` } : null}
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

const COMPARE_COLORS = ['var(--chart-trend)', '#e8772e', '#5b7cfa', '#c04fd8', '#d9a400', '#2fb5b5'];

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
      <LineChart ariaLabel="Сравнение изменения параметров в процентах" from={from} to={dayNumber(today())} unit="%" height={300} series={series} formatValue={(v) => `${fmtSigned(v, 1)}%`} />
      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, style: 'line' }))} />
      <p className="small muted">Каждая линия — изменение параметра в процентах от первого значения в выбранном периоде. Так вес и обхваты можно сравнивать на одной шкале.</p>
    </section>
  );
}

function HistoryTab({ data }: { data: AppData }) {
  const openEntry = useOpenEntry();
  const { confirm, toast } = useFeedback();
  const [limit, setLimit] = useState(60);
  const rows = [...data.entries].reverse();
  const measLabel = (e: Entry) =>
    Object.entries(e.measurements)
      .map(([k, v]) => `${metricLabel(k, data.customMetrics).label} ${fmtNum(v!, 1)}`)
      .join(', ');

  if (!rows.length) return <EmptyState icon="note" title="История пуста" text="Здесь появятся все внесённые записи." />;

  const remove = async (e: Entry) => {
    if (!(await confirm({ title: 'Удалить запись?', text: `${formatDate(e.date)}, ${e.time}`, danger: true, confirm: 'Удалить' }))) return;
    await deleteEntry(e.id);
    toast('Запись удалена', { action: { label: 'Вернуть', run: () => void addEntry({ date: e.date, time: e.time, weight: e.weight, bodyFat: e.bodyFat, measurements: e.measurements, note: e.note, source: e.source }) } });
  };

  return (
    <section className="card history">
      <div className="card-head">
        <h2>Все записи</h2>
        <span className="badge num">{rows.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Вес</th>
              <th className="hide-sm">Жир</th>
              <th className="hide-sm">Измерения</th>
              <th className="hide-sm">Заметка</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="strong">{formatDate(e.date)}</div>
                  <div className="xs faint num">{e.time}</div>
                </td>
                <td className="num strong">{e.weight != null ? fmtNum(e.weight, 1) : '—'}</td>
                <td className="num hide-sm">{e.bodyFat != null ? `${fmtNum(e.bodyFat, 1)}%` : '—'}</td>
                <td className="hide-sm small muted clip">{measLabel(e) || '—'}</td>
                <td className="hide-sm small muted clip">{e.note || '—'}</td>
                <td className="actions">
                  <button className="btn icon sm ghost" aria-label="Редактировать" onClick={() => openEntry({ entryId: e.id })}>
                    <Icon name="edit" size={17} />
                  </button>
                  <button className="btn icon sm ghost" aria-label="Удалить" onClick={() => remove(e)}>
                    <Icon name="trash" size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => setLimit(limit + 100)}>
          Показать ещё
        </button>
      )}
    </section>
  );
}

