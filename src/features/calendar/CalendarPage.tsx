import { useMemo, useState } from 'react';
import { PageHeader, useIsDesktop } from '@/app/Layout';
import { useData } from '@/state/store';
import type { AppData, ISODate } from '@/domain/types';
import { addDays, addMonths, daysInMonth, formatDate, formatMonthYear, startOfMonth, today, weekday, WEEKDAYS_SHORT } from '@/lib/dates';
import { indexLogs, isDoneValue, isScheduledOn, logValue } from '@/lib/habits';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { fmtKg, fmtNum } from '@/lib/format';
import { metricLabel } from '@/lib/metrics';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { HabitControl } from '@/features/habits/HabitsPage';
import { PhotoThumb } from '@/features/photos/PhotoThumb';
import { useLock } from '@/app/lock';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import './calendar.css';

interface DayInfo {
  weight: number | null;
  measured: boolean;
  note: boolean;
  habitsDone: number;
  habitsDue: number;
  photos: number;
  achievements: number;
}

function buildMonth(data: AppData, month: ISODate): Map<ISODate, DayInfo> {
  const [y, m] = month.split('-').map(Number);
  const n = daysInMonth(y, m);
  const idx = indexLogs(data.habitLogs);
  const out = new Map<ISODate, DayInfo>();
  for (let i = 0; i < n; i++) {
    const d = addDays(month, i);
    const es = data.entries.filter((e) => e.date === d);
    const ws = es.filter((e) => e.weight != null).map((e) => e.weight!);
    const due = data.habits.filter((h) => isScheduledOn(h, d));
    out.set(d, {
      weight: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null,
      measured: es.some((e) => e.bodyFat != null || Object.keys(e.measurements).length > 0),
      note: es.some((e) => e.note.trim().length > 0),
      habitsDue: due.length,
      habitsDone: data.habits.filter((h) => isDoneValue(h, logValue(idx, h.id, d))).length,
      photos: data.photos.filter((p) => p.date === d).length,
      achievements: data.achievements.filter((a) => a.date === d).length,
    });
  }
  return out;
}

export default function CalendarPage() {
  const data = useData();
  const [month, setMonth] = useState(startOfMonth(today()));
  const [selected, setSelected] = useState<ISODate | null>(null);
  const info = useMemo(() => buildMonth(data, month), [data, month]);
  const lead = weekday(month);
  const d0 = today();
  const isDesktop = useIsDesktop();

  return (
    <div className="page">
      <PageHeader title="Календарь" subtitle="Вся активность по дням" />
      <div className="cal-layout">
        <section className="card cal">
          <div className="cal-head">
            <button className="btn icon ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">
              <Icon name="left" />
            </button>
            <h2 aria-live="polite">{formatMonthYear(month)}</h2>
            <button className="btn icon ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Следующий месяц">
              <Icon name="right" />
            </button>
          </div>
          <div className="cal-grid" role="grid" aria-label={formatMonthYear(month)}>
            {WEEKDAYS_SHORT.map((w) => (
              <div key={w} className="cal-wd" role="columnheader">{w}</div>
            ))}
            {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
            {[...info.entries()].map(([d, i]) => {
              const future = d > d0;
              const ratio = i.habitsDue ? i.habitsDone / i.habitsDue : null;
              return (
                <button
                  key={d}
                  role="gridcell"
                  className={`cal-day ${d === d0 ? 'today' : ''} ${selected === d ? 'sel' : ''} ${future ? 'future' : ''}`}
                  onClick={() => setSelected(d)}
                  aria-label={`${formatDate(d)}${i.weight != null ? `, вес ${fmtNum(i.weight, 2)}` : ''}${i.habitsDue ? `, привычки ${i.habitsDone} из ${i.habitsDue}` : ''}`}
                >
                  <span className="cal-num num">{Number(d.slice(8))}</span>
                  {i.weight != null && <span className="cal-w num">{fmtNum(i.weight, 2)}</span>}
                  {ratio != null && !future && (
                    <span className="cal-bar" aria-hidden="true">
                      <span style={{ width: `${ratio * 100}%` }} className={ratio >= 1 ? 'full' : ''} />
                    </span>
                  )}
                  <span className="cal-marks" aria-hidden="true">
                    {i.measured && <i className="m-meas" />}
                    {i.photos > 0 && <i className="m-photo" />}
                    {i.achievements > 0 && <i className="m-ach" />}
                    {i.note && <i className="m-note" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-legend small muted">
            <span><b className="lg-w">72,4</b> вес</span>
            <span><i className="cal-legend-bar" /> привычки</span>
            <span><i className="m-meas" /> измерения</span>
            <span><i className="m-photo" /> фото</span>
            <span><i className="m-ach" /> достижение</span>
            <span><i className="m-note" /> заметка</span>
          </div>
        </section>
        {isDesktop ? (
          <section className="card day-panel">{selected ? <DayDetails data={data} date={selected} /> : <p className="muted small">Выбери день, чтобы увидеть подробности.</p>}</section>
        ) : (
          selected && (
            <Sheet open onClose={() => setSelected(null)} title={formatDate(selected, { weekday: true })}>
              <DayDetails data={data} date={selected} hideTitle />
            </Sheet>
          )
        )}
      </div>
    </div>
  );
}

function DayDetails({ data, date, hideTitle }: { data: AppData; date: ISODate; hideTitle?: boolean }) {
  const openEntry = useOpenEntry();
  const { locked, hasPin } = useLock();
  const photosLocked = hasPin && locked && data.settings.lockScope === 'photos';
  const entries = data.entries.filter((e) => e.date === date);
  const idx = indexLogs(data.habitLogs);
  const habits = data.habits.filter((h) => isScheduledOn(h, date) || logValue(idx, h.id, date) != null);
  const photos = data.photos.filter((p) => p.date === date);
  const ach = data.achievements.filter((a) => a.date === date);

  return (
    <div className="stack">
      {!hideTitle && <h2>{formatDate(date, { weekday: true })}</h2>}
      <div>
        <div className="row between">
          <h3>Измерения</h3>
          <button className="btn sm" onClick={() => openEntry({ date })}><Icon name="plus" size={16} /> Добавить</button>
        </div>
        {entries.length ? (
          <div className="list">
            {entries.map((e) => (
              <button key={e.id} className="list-item" onClick={() => openEntry({ entryId: e.id })}>
                <span className="time-pill num">{e.time}</span>
                <span className="grow">
                  {e.weight != null && <span className="strong num">{fmtKg(e.weight)}</span>}
                  {e.bodyFat != null && <span className="small muted num"> · жир {fmtNum(e.bodyFat, 2)}%</span>}
                  {Object.keys(e.measurements).length > 0 && (
                    <span className="small muted" style={{ display: 'block' }}>
                      {Object.entries(e.measurements).map(([k, v]) => `${metricLabel(k, data.customMetrics).label} ${fmtNum(v!, 2)}`).join(' · ')}
                    </span>
                  )}
                  {e.note && <span className="small" style={{ display: 'block', marginTop: 2 }}>📝 {e.note}</span>}
                </span>
                <Icon name="edit" size={16} className="faint" />
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">Нет записей.</p>
        )}
      </div>
      {habits.length > 0 && (
        <div>
          <h3>Привычки</h3>
          <div className="list">
            {habits.map((h) => (
              <div key={h.id} className="list-item">
                <span className="list-icon">{h.icon}</span>
                <span className="grow">{h.name}</span>
                <HabitControl habit={h} date={date} value={logValue(idx, h.id, date)} compact />
              </div>
            ))}
          </div>
        </div>
      )}
      {photos.length > 0 && (
        <div>
          <h3>Фото</h3>
          {photosLocked ? (
            <p className="small muted"><Icon name="lock" size={14} /> {photos.length} фото — раздел защищён PIN-кодом</p>
          ) : (
            <div className="day-photos">
              {photos.map((p) => <PhotoThumb key={p.id} photo={p} />)}
            </div>
          )}
        </div>
      )}
      {ach.length > 0 && (
        <div>
          <h3>Достижения</h3>
          <div className="list">
            {ach.map((a) => {
              const def = ACHIEVEMENTS.find((x) => x.id === a.id);
              return def ? (
                <div key={a.id} className="list-item">
                  <span className="list-icon">{def.icon}</span>
                  <span className="grow strong">{def.title}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
