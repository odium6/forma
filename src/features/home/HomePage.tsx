import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Menu } from 'glisse';
import { useData, setHabitLog, saveSettings } from '@/state/store';
import { goalProgress } from '@/lib/math/progress';
import { computeSummary, STATUS_TEXT, type Summary } from '@/lib/summary';
import { habitStats, indexLogs, isDoneValue } from '@/lib/habits';
import { formatDate, today } from '@/lib/dates';
import { fmtKg, fmtNum, fmtSigned } from '@/lib/format';
import { WeightChart } from '@/features/charts/WeightChart';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/feedback';
import { skippedToday, skipToday } from '@/lib/push';
import { Flame } from '@/ui/Flame';
import { StartSheet } from '@/features/goal/StartSheet';
import { Sheet } from '@/ui/Sheet';
import { mainStreak, streakTargets, weighStreak } from '@/lib/streaks';
import { plural } from '@/lib/format';
import type { AppData } from '@/domain/types';
import type { IconName } from '@/ui/Icon';
import type { ThemeMode } from '@/domain/types';
import './home.css';

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: 'light', label: 'Светлая тема', icon: 'sun' },
  { mode: 'dark', label: 'Тёмная тема', icon: 'moon' },
  { mode: 'system', label: 'Как в системе', icon: 'monitor' },
];

export function HomePage() {
  const data = useData();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  const s = useMemo(() => computeSummary(data), [data]);

  return (
    <div className="page home">
      <header className="page-head home-head">
        <div className="grow">
          <h1 className="sr-only">Главная</h1>
          <p className="home-date">{formatDate(today(), { weekday: true })}</p>
        </div>
        <Menu
          aria-label="Быстрые действия"
          align="end"
          items={[
            { label: 'Внести измерения тела', icon: <Icon name="ruler" size={18} />, onSelect: () => openEntry({ focus: 'measurements' }) },
            { label: 'Сформировать отчёт', icon: <Icon name="report" size={18} />, onSelect: () => nav('/reports') },
            { label: 'Календарь', icon: <Icon name="calendar" size={18} />, onSelect: () => nav('/calendar') },
            'separator',
            ...THEME_OPTIONS.map((t) => ({
              label: `${t.label}${data.settings.theme === t.mode ? '  ✓' : ''}`,
              icon: <Icon name={t.icon} size={18} />,
              onSelect: () => void saveSettings({ theme: t.mode }),
            })),
          ]}
        />
      </header>

      <div className="dash">
        <div className="col">
          <StreakCard data={data} />
          <HeroCard s={s} data={data} />
          {s.points.length > 0 && (
            <section className="card" aria-labelledby="chart-h">
              <div className="card-head">
                <h2 id="chart-h">Последний месяц</h2>
                <Link to="/progress">Подробнее</Link>
              </div>
              <WeightChart data={data} summary={s} height={170} compact />
            </section>
          )}
        </div>
        <div className="col">
          <TodayCard data={data} />
        </div>
      </div>
    </div>
  );
}

function HeroCard({ s, data }: { s: Summary; data: AppData }) {
  const openEntry = useOpenEntry();
  const status = STATUS_TEXT[s.status];
  const f = s.forecast;
  const [startOpen, setStartOpen] = useState(false);

  if (!s.points.length) {
    return (
      <section className="card hero hero-empty">
        <span className="empty-art"><Icon name="scale" size={26} /></span>
        <h2>Внеси первый вес</h2>
        <p className="muted">Дальше FORMA покажет тренд и путь к цели.</p>
        <button className="btn primary lg" onClick={() => openEntry({ focus: 'weight' })} data-testid="home-add-weight">
          <Icon name="plus" size={20} /> Внести вес
        </button>
      </section>
    );
  }

  const m = s.maintenance;
  const g = s.goal;
  // the hero shows the weight the user actually entered last; the smoothed trend lives in charts
  // exactly what was entered last (several readings on one day are averaged in s.latest)
  const d0 = today();
  const now = [...data.entries].reverse().find((e) => e.weight != null && e.date <= d0)?.weight ?? s.latest!.value;
  const fromStart = g ? now - g.startWeight : null;
  const prog = g && s.target != null ? goalProgress(g.startWeight, s.target, now) : null;
  const pct = prog ? Math.round(prog.fraction * 100) : null;

  return (
    <section className="card hero" aria-label="Прогресс к цели">
      <span className="t-caption">Текущий вес</span>
      <div className="hero-value">
        <span className="t-display num" data-testid="current-weight">{fmtNum(now, 2)}</span>
        <span className="hero-unit">кг</span>
      </div>
      {fromStart != null && !m && Math.abs(fromStart) >= 0.01 && (
        <p className="hero-delta">
          <span className="num strong">{fmtSigned(fromStart, 2, 'кг')}</span> от старта
          {pct != null && pct > 0 && (
            <>
              {' · '}
              <span className="num strong accent">{pct}%</span>
            </>
          )}
        </p>
      )}

      {m ? (
        <MaintenanceBand s={s} />
      ) : g && s.target != null && prog ? (
        <Journey start={g.startWeight} target={s.target} fraction={prog.fraction} left={prog.leftKg} reached={prog.state === 'reached'} onStart={() => setStartOpen(true)} />
      ) : null}
      {!m && g && s.target != null && prog && prog.state !== 'reached' && (g.targetDate || (f.status === 'ok' && f.date)) ? (
        <p className="goal-date">
          <Icon name="target" size={15} />
          {g.targetDate ? <>Цель к <strong>{formatDate(g.targetDate, { year: true })}</strong></> : <>Прогноз: <strong>{formatDate(f.date!, { year: true })}</strong></>}
        </p>
      ) : null}
      <AddRow />
      <span className="sr-only" data-testid="status">{status.title}</span>
      {startOpen && g && <StartSheet goal={g} onClose={() => setStartOpen(false)} />}
      {f.status === 'ok' && f.date && !m && <span className="sr-only" data-testid="forecast">Прогноз: {formatDate(f.date)}</span>}
    </section>
  );
}

function AddRow() {
  const openEntry = useOpenEntry();
  const { toast } = useFeedback();
  const [, setTick] = useState(0);
  return (
    <div className="add-row">
      <button className="btn primary lg grow" onClick={() => openEntry({ focus: 'weight' })} data-testid="home-add-weight">
        <Icon name="plus" size={20} strokeWidth={2.4} /> Внести вес
      </button>
      <Menu
        aria-label="Внести другое"
        align="end"
        icon={<Icon name="ruler" size={20} />}
        items={[
          { label: 'Параметры тела', icon: <Icon name="ruler" size={18} />, onSelect: () => openEntry({ focus: 'measurements' }) },
          { label: 'Заметка', icon: <Icon name="note" size={18} />, onSelect: () => openEntry({ focus: 'note' }) },
          'separator',
          {
            label: 'Сегодня не могу взвеситься',
            icon: <Icon name="close" size={18} />,
            onSelect: () => {
              void skipToday('weigh').then(() => {
                setTick((t) => t + 1);
                toast('Хорошо, сегодня больше не напомню');
              });
            },
          },
        ]}
      />
    </div>
  );
}

function Journey({ start, target, fraction, left, reached, onStart }: { start: number; target: number; fraction: number; left: number; reached: boolean; onStart?: () => void }) {
  const pct = Math.round(fraction * 1000) / 10;
  return (
    <div className="journey">
      <div
        className="journey-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`Пройдено ${Math.round(pct)}% пути от ${fmtKg(start)} до ${fmtKg(target)}`}
      >
        <span className="journey-fill" style={{ width: `${pct}%` }} />
        <span className="journey-pin" style={{ left: `${pct}%` }} />
      </div>
      <div className="journey-labels">
        <button type="button" className="journey-start" onClick={onStart} aria-label={`Старт ${fmtKg(start)}. Изменить`}>
          <span className="t-caption">Старт ✎</span>
          <span className="num">{fmtKg(start)}</span>
        </button>
        <span className="journey-left">
          <span className="t-caption">{reached ? 'Цель' : 'Осталось'}</span>
          <span className="num strong" data-testid="left-kg">{reached ? 'достигнута' : fmtKg(left)}</span>
        </span>
        <span className="end">
          <span className="t-caption">Цель</span>
          <span className="num">{fmtKg(target)}</span>
        </span>
      </div>
    </div>
  );
}

function MaintenanceBand({ s }: { s: Summary }) {
  const m = s.maintenance!;
  const span = m.high - m.low;
  const lo = m.low - span;
  const hi = m.high + span;
  const pos = Math.max(0, Math.min(1, (s.current! - lo) / (hi - lo)));
  return (
    <div className="journey" role="img" aria-label={`Текущий вес ${fmtNum(s.current!, 2)} кг, диапазон ${fmtNum(m.low, 2)}–${fmtNum(m.high, 2)} кг`}>
      <div className="journey-track">
        <span className="mband-zone" />
        <span className="journey-pin" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="journey-labels">
        <span>
          <span className="t-caption">Диапазон</span>
          <span className="num">{fmtNum(m.low, 2)}–{fmtNum(m.high, 2)} кг</span>
        </span>
        <span className="end">
          <span className="t-caption">Сейчас</span>
          <span className="num strong">{m.state === 'inside' ? 'внутри' : `${m.state === 'above' ? 'выше' : 'ниже'} на ${fmtKg(Math.abs(m.deviation))}`}</span>
        </span>
      </div>
    </div>
  );
}

function TodayCard({ data }: { data: AppData }) {
  const openEntry = useOpenEntry();
  const d = today();
  const weighed = data.entries.some((e) => e.date === d && e.weight != null);
  const ws = weighStreak(data, d);
  const idx = indexLogs(data.habitLogs);
  const habits = data.habits.filter((h) => !h.archivedAt).map((h) => ({ h, s: habitStats(h, idx, d) })).filter((x) => x.s.todayScheduled);
  const total = habits.length + 1;
  const done = habits.filter((x) => x.s.todayDone).length + (weighed ? 1 : 0);

  return (
    <section className="card" aria-labelledby="today-h">
      <div className="card-head">
        <h2 id="today-h">Сегодня</h2>
        <span className="today-count num" aria-label={`Выполнено ${done} из ${total}`}>
          {done}/{total}
        </span>
      </div>
      <div className="list today-list">
        <div className={`list-item today-row${weighed ? ' done' : ''}`}>
          <button className={`check-dot ${weighed ? 'on' : ''}`} aria-label={weighed ? 'Вес внесён. Внести ещё' : 'Внести вес'} onClick={() => openEntry({ focus: 'weight' })}>
            {weighed && <Icon name="check" size={15} strokeWidth={2.6} />}
          </button>
          <button className="today-name" onClick={() => openEntry({ focus: 'weight' })}>
            <Icon name="scale" size={17} className="today-ico" /> Взвешивание
          </button>
          {!weighed && skippedToday('weigh') && <span className="t-caption">не сегодня</span>}
          <StreakBadge count={ws.count} />
        </div>
        {habits.map(({ h, s }) => (
          <div key={h.id} className={`list-item today-row${s.todayDone ? ' done' : ''}`}>
            <button
              className={`check-dot ${s.todayDone ? 'on' : ''}`}
              aria-label={`${h.name}: ${s.todayDone ? 'снять отметку' : 'отметить выполнение'}`}
              aria-pressed={s.todayDone}
              onClick={() => {
                if (h.kind === 'check') void setHabitLog(h.id, d, s.todayDone ? null : 1);
                else if (h.kind === 'count') void setHabitLog(h.id, d, s.todayDone ? null : h.target);
                else void setHabitLog(h.id, d, isDoneValue(h, s.todayValue) ? null : 0);
              }}
            >
              {s.todayDone && <Icon name="check" size={15} strokeWidth={2.6} />}
            </button>
            <Link to="/habits" className="today-name">
              <span aria-hidden="true" className="today-emoji">{h.icon}</span> {h.name}
            </Link>
            <StreakBadge count={s.current} week={s.unit === 'week'} />
          </div>
        ))}
        {habits.length === 0 && (
          <Link to="/habits" className="list-item today-row">
            <span className="check-dot add">
              <Icon name="plus" size={14} />
            </span>
            <span className="grow muted">Добавить привычку</span>
            <Icon name="right" size={16} className="chev" />
          </Link>
        )}
      </div>
    </section>
  );
}

function StreakCard({ data }: { data: AppData }) {
  const [choosing, setChoosing] = useState(false);
  const st = mainStreak(data);
  const word = st.unit === 'week' ? plural(st.count, ['неделя', 'недели', 'недель']) : plural(st.count, ['день', 'дня', 'дней']);
  return (
    <>
      <button className="card streak-card" onClick={() => setChoosing(true)} aria-label={`Огонёк: ${st.label}, ${st.count} ${word} подряд. Сменить цель огонька`} data-testid="main-flame">
        <Flame size={76} lit={st.count > 0} animated />
        <span className="streak-text">
          <span className="streak-count num">
            {st.count} <span className="streak-word">{word} подряд</span>
          </span>
          <span className="streak-target">
            {st.icon} {st.label}
            {st.todayDone ? <span className="streak-ok"> · сегодня ✓</span> : <span className="faint"> · сегодня ещё нет</span>}
          </span>
        </span>
        <Icon name="right" size={18} className="chev" />
      </button>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="Огонёк для чего?" size="sm">
        <div className="list">
          {streakTargets(data).map((t) => (
            <button
              key={t.id}
              className="list-item"
              aria-pressed={t.id === st.id}
              onClick={() => {
                void saveSettings({ mainStreak: t.id });
                setChoosing(false);
              }}
            >
              <Flame size={22} lit={t.count > 0} />
              <span className="list-text">
                <span className="list-title">{t.icon} {t.label}</span>
                <span className="list-sub num">{t.count} {t.unit === 'week' ? 'нед.' : 'дн.'} подряд</span>
              </span>
              {t.id === st.id && <Icon name="check" size={18} className="accent" />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function StreakBadge({ count, week }: { count: number; week?: boolean }) {
  if (count <= 0) return null;
  return (
    <span className="streak-badge num" title={`${count} ${week ? 'нед.' : 'дн.'} подряд`} aria-label={`${count} ${week ? 'нед.' : 'дн.'} подряд`}>
      <Flame size={14} /> {count}
    </span>
  );
}
