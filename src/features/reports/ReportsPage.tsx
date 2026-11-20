import { useMemo, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import { useLock } from '@/app/lock';
import { getPhotoBlob, saveSettings, useData } from '@/state/store';
import { buildReport, PERIOD_LABELS, periodRange, type ReportPeriod } from '@/lib/reports';
import { addDays, dayNumber, formatDate, today } from '@/lib/dates';
import { fmtNum, fmtSigned, fmtPct } from '@/lib/format';
import { entriesCSV, saveFile, stamp } from '@/lib/export/files';
import { activeGoal } from '@/lib/insights';
import { LineChart, ChartLegend } from '@/ui/LineChart';
import { Segmented, ToggleRow, EmptyState } from '@/ui/controls';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { PhotoThumb } from '@/features/photos/PhotoThumb';
import './reports.css';

const PERIODS: ReportPeriod[] = ['week', 'month', '3m', '6m', 'year', 'custom', 'goal'];
const SHORT: Record<ReportPeriod, string> = { week: 'Нед', month: 'Мес', '3m': '3М', '6m': '6М', year: 'Год', custom: 'Свой', goal: 'Цель' };
const CAT: Record<string, string> = { front: 'Спереди', side: 'Сбоку', back: 'Сзади', other: 'Другое' };

export default function ReportsPage() {
  const data = useData();
  const { toast } = useFeedback();
  const { locked, hasPin } = useLock();
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [custom, setCustom] = useState({ from: addDays(today(), -29), to: today() });
  const [busy, setBusy] = useState<string | null>(null);
  const range = periodRange(period, data, today(), custom);
  const report = useMemo(() => buildReport(data, range.from, range.to), [data, range.from, range.to]);
  const includePhotos = data.settings.includePhotosInReports && !(hasPin && locked);
  const goal = activeGoal(data);
  const w = report.weight;

  // first and last photo per category within the period
  const reportPhotos = useMemo(() => {
    const out: typeof report.photos = [];
    for (const c of ['front', 'side', 'back']) {
      const ps = report.photos.filter((p) => p.category === c).sort((a, b) => a.date.localeCompare(b.date));
      if (ps.length) out.push(ps[0]);
      if (ps.length > 1) out.push(ps[ps.length - 1]);
    }
    return out;
  }, [report]);

  const exportPDF = async () => {
    setBusy('pdf');
    try {
      const { buildReportPDF } = await import('@/lib/export/pdf');
      const photos: { label: string; jpeg: ArrayBuffer }[] = [];
      if (includePhotos) {
        for (const p of reportPhotos) {
          const b = await getPhotoBlob(p.id, 'thumb');
          if (b) photos.push({ label: `${CAT[p.category]} · ${formatDate(p.date)}`, jpeg: await b.arrayBuffer() });
        }
      }
      const blob = await buildReportPDF(report, { name: data.profile?.name ?? '', target: goal?.targetWeight ?? null, photos });
      await saveFile(blob, `forma-report-${report.from}_${report.to}.pdf`);
    } catch (e) {
      console.error(e);
      toast('Не удалось сформировать PDF', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const exportCSV = async () => {
    await saveFile(new Blob([entriesCSV(report.entries, data.customMetrics)], { type: 'text/csv;charset=utf-8' }), `forma-entries-${report.from}_${report.to}.csv`);
  };

  const exportJSON = async () => {
    const json = {
      app: 'FORMA',
      kind: 'report',
      generatedAt: new Date().toISOString(),
      period: { from: report.from, to: report.to, days: report.days },
      weight: { ...w, points: w.points.map((p, i) => ({ date: p.date, value: p.value, trend: Number(w.trend[i].toFixed(3)) })), trend: undefined },
      bodyFat: report.bodyFat,
      measurements: report.measurements,
      habits: report.habits,
      habitRate: report.habitRate,
      achievements: report.achievements,
      entries: report.entries,
    };
    await saveFile(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), `forma-report-${report.from}_${report.to}-${stamp()}.json`);
  };

  return (
    <div className="page">
      <PageHeader title="Отчёты" subtitle={`${formatDate(range.from, { year: true })} — ${formatDate(range.to, { year: true })}`} />
      <Segmented label="Период отчёта" value={period} onChange={setPeriod} items={PERIODS.map((p) => ({ value: p, label: SHORT[p] }))} className="range-seg" />
      {period === 'custom' && (
        <div className="grid-2" style={{ maxWidth: 480 }}>
          <div className="field">
            <label htmlFor="r-from">С</label>
            <input id="r-from" className="input" type="date" max={custom.to} value={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="r-to">По</label>
            <input id="r-to" className="input" type="date" min={custom.from} max={today()} value={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        </div>
      )}
      {period === 'goal' && !data.goals.length && <p className="small muted">Цель не задана — показаны последние 30 дней.</p>}

      <section className="card export-bar">
        <div className="grow">
          <h3>Скачать отчёт · {PERIOD_LABELS[period].toLowerCase()}</h3>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={exportPDF} disabled={!!busy} data-testid="export-pdf"><Icon name="download" size={18} /> {busy === 'pdf' ? 'Готовим…' : 'PDF'}</button>
          <button className="btn" onClick={exportCSV} data-testid="export-csv"><Icon name="download" size={18} /> CSV</button>
          <button className="btn" onClick={exportJSON} data-testid="export-json"><Icon name="download" size={18} /> JSON</button>
        </div>
      </section>

      {w.points.length === 0 && report.habits.length === 0 ? (
        <section className="card"><EmptyState icon="report" title="Нет данных за период" text="Выбери другой период или внеси измерения." /></section>
      ) : (
        <div className="dash">
          <div className="col">
            <section className="card">
              <div className="report-tiles">
                <Tile label="Начальный вес" value={w.start != null ? `${fmtNum(w.start, 1)} кг` : '—'} />
                <Tile label="Конечный вес" value={w.end != null ? `${fmtNum(w.end, 1)} кг` : '—'} />
                <Tile label="Изменение" value={w.change != null ? `${fmtSigned(w.change, 1)} кг` : '—'} hint={w.trendChange != null ? `тренд ${fmtSigned(w.trendChange, 1)} кг` : undefined} />
                <Tile label="Средний вес" value={w.average != null ? `${fmtNum(w.average, 1)} кг` : '—'} />
                <Tile label="Минимум / максимум" value={w.min && w.max ? `${fmtNum(w.min.value, 1)} / ${fmtNum(w.max.value, 1)}` : '—'} />
                <Tile label="Дней с весом" value={`${w.loggedDays} / ${report.days}`} />
              </div>
            </section>
            {w.points.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>Вес</h2></div>
                <LineChart
                  ariaLabel="Вес за период отчёта"
                  from={dayNumber(report.from)}
                  to={dayNumber(report.to)}
                  unit="кг"
                  height={240}
                  target={goal?.targetWeight != null ? { value: goal.targetWeight, label: 'Цель' } : null}
                  series={[
                    { id: 'raw', label: 'Измерение', points: w.points, style: 'dots', color: 'var(--chart-dot)' },
                    { id: 'trend', label: 'Тренд', points: w.points.map((p, i) => ({ day: p.day, value: w.trend[i] })), style: 'line', color: 'var(--chart-trend)', breakGapDays: 21 },
                  ]}
                />
                <ChartLegend items={[{ label: 'Измерения', color: 'var(--chart-dot)', style: 'dots' }, { label: 'Тренд', color: 'var(--chart-trend)', style: 'line' }]} />
              </section>
            )}
            {(report.measurements.length > 0 || report.bodyFat.count > 0) && (
              <section className="card">
                <div className="card-head"><h2>Измерения</h2></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Параметр</th><th>Начало</th><th>Конец</th><th>Изменение</th></tr></thead>
                    <tbody>
                      {[...(report.bodyFat.count ? [report.bodyFat] : []), ...report.measurements].map((m) => (
                        <tr key={m.key}>
                          <td>{m.label}</td>
                          <td className="num">{m.first ? `${fmtNum(m.first.value, 1)} ${m.unit}` : '—'}</td>
                          <td className="num">{m.last ? `${fmtNum(m.last.value, 1)} ${m.unit}` : '—'}</td>
                          <td className="num strong">{m.change != null ? `${fmtSigned(m.change, 1)} ${m.unit}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
          <div className="col">
            {report.habits.length > 0 && (
              <section className="card">
                <div className="card-head">
                  <h2>Привычки</h2>
                  {report.habitRate != null && <span className="badge positive num">{fmtPct(report.habitRate)}</span>}
                </div>
                <div className="list">
                  {report.habits.map((h) => (
                    <div key={h.id} className="list-item">
                      <span className="list-icon">{h.icon}</span>
                      <span className="grow">
                        <span className="strong">{h.name}</span>
                        <span className="small muted" style={{ display: 'block' }}>{h.done} из {h.scheduled} · лучшая серия {h.bestStreakInPeriod}</span>
                      </span>
                      <span className="num strong">{h.rate != null ? fmtPct(h.rate) : '—'}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className="card">
              <div className="card-head"><h2>Достижения</h2></div>
              {report.achievements.length ? (
                <div className="list">
                  {report.achievements.map((a) => (
                    <div key={a.id} className="list-item">
                      <span className="list-icon">{a.icon}</span>
                      <span className="grow strong">{a.title}</span>
                      <span className="small muted">{formatDate(a.date)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted">За этот период новых достижений нет.</p>
              )}
            </section>
            <section className="card">
              <ToggleRow icon="image" title="Фото в отчёте" hint="Первое и последнее фото каждого ракурса за период" checked={data.settings.includePhotosInReports} onChange={(v) => void saveSettings({ includePhotosInReports: v })} />
              {data.settings.includePhotosInReports && (hasPin && locked ? (
                <p className="small muted">Раздел фото заблокирован — разблокируй его, чтобы добавить фото в отчёт.</p>
              ) : reportPhotos.length ? (
                <div className="report-photos">
                  {reportPhotos.map((p) => (
                    <figure key={p.id}>
                      <PhotoThumb photo={data.photos.find((x) => x.id === p.id)!} />
                      <figcaption className="xs muted">{CAT[p.category]} · {formatDate(p.date)}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="small muted">Нет фото за этот период.</p>
              ))}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="stat-label">{label}</div>
      <div className="tile-value num">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
