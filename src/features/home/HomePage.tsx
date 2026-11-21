import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { Menu } from 'glisse';
import { useData, setHabitLog, saveSettings } from '@/state/store';
import { computeSummary, STATUS_TEXT, type Summary } from '@/lib/summary';
import { visibleInsights } from '@/lib/insights';
import { habitStats, indexLogs, isDoneValue } from '@/lib/habits';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { diffDays, formatDate, today } from '@/lib/dates';
import { fmtKg, fmtNum, fmtSigned, nDays } from '@/lib/format';
import { WeightChart } from '@/features/charts/WeightChart';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { Icon } from '@/ui/Icon';
import type { AppData } from '@/domain/types';
import type { IconName } from '@/ui/Icon';
import type { ThemeMode } from '@/domain/types';
import './home.css';

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: 'light', label: 'Светлая тема', icon: 'sun' },
  { mode: 'dark', label: 'Тёмная тема', icon: 'moon' },
  { mode: 'system', label: 'Как в системе', icon: 'monitor' },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function ago(days: number): string {
  return days === 0 ? 'сегодня' : days === 1 ? 'вчера' : `${nDays(days)} назад`;
}

export function HomePage() {
  const data = useData();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  const s = useMemo(() => computeSummary(data), [data]);
  const insights = useMemo(() => visibleInsights(data, undefined, 3), [data]);

  return (
    <div className="page home">
      <header className="page-head home-head">
        <div className="grow">
          <p className="t-caption">{formatDate(today(), { weekday: true })}</p>
          <h1 className="home-greet">
            {greeting()}
            {data.profile?.name ? `, ${data.profile.name}` : ''}
          </h1>
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
          <HeroCard s={s} />
          {s.points.length > 0 && <QuickStats s={s} />}
          {s.points.length > 0 && (
            <section className="card" aria-labelledby="chart-h">
              <div className="card-head">
                <h2 id="chart-h">Динамика веса</h2>
                <Link to="/progress">Подробнее</Link>
              </div>
              <WeightChart data={data} summary={s} height={220} />
            </section>
          )}
        </div>
        <div className="col">
          <TodayCard data={data} />
          {insights.length > 0 && (
            <section className="section" aria-labelledby="ins-h">
              <div className="section-head">
                <h2 id="ins-h">Наблюдения</h2>
              </div>
              <ul className="insights">
                {insights.map((i) => (
                  <li key={i.id} className={`insight tone-${i.tone}`}>
                    <span className="insight-dot" aria-hidden="true" />
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <RecentAchievements data={data} />
        </div>
      </div>
    </div>
  );
}

function HeroCard({ s }: { s: Summary }) {
  const openEntry = useOpenEntry();
  const status = STATUS_TEXT[s.status];
  const f = s.forecast;

  if (!s.points.length) {
    return (
      <section className="card hero hero-empty">
        <span className="empty-art"><Icon name="scale" size={26} /></span>
        <h2>Внеси первый вес</h2>
        <p className="muted">FORMA построит тренд, покажет путь к цели и прогноз по твоим реальным измерениям.</p>
        <button className="btn primary lg" onClick={() => openEntry({ focus: 'weight' })}>
          <Icon name="plus" size={20} /> Внести вес
        </button>
      </section>
    );
  }

  const m = s.maintenance;
  const g = s.goal;
  const fromStart = g ? s.current! - g.startWeight : null;
  const pct = s.progress ? Math.round(s.progress.fraction * 100) : null;

  return (
    <section className="card hero" aria-label="Прогресс к цели">
      <div className="hero-top">
        <span className="t-caption">Текущий вес · тренд</span>
        <span className={`badge ${status.tone === 'positive' ? 'positive' : status.tone === 'warn' ? 'warn' : ''}`} data-testid="status">
          {status.title}
        </span>
      </div>
      <div className="hero-value">
        <span className="t-display num" data-testid="current-weight">{fmtNum(s.current!, 2)}</span>
        <span className="hero-unit">кг</span>
      </div>
      <p className="hero-delta">
        {fromStart != null && !m ? (
          <>
            <span className="num strong">{fmtSigned(fromStart, 2, 'кг')}</span> от старта
            {pct != null && (
              <>
                {' · '}
                <span className="num strong accent">{pct}%</span> пути
              </>
            )}
          </>
        ) : (
          <>
            Последнее измерение: <span className="num strong">{fmtKg(s.latest!.value)}</span>, {ago(diffDays(today(), s.latest!.date))}
          </>
        )}
      </p>

      {m ? (
        <MaintenanceBand s={s} />
      ) : g && s.target != null && s.progress ? (
        <Journey start={g.startWeight} target={s.target} fraction={s.progress.fraction} left={s.progress.leftKg} reached={s.progress.state === 'reached'} />
      ) : (
        <Link to="/progress#goal" className="hero-goal-cta">
          <Icon name="target" size={18} />
          <span className="grow">Задай цель, чтобы видеть путь и прогноз</span>
          <Icon name="right" size={16} />
        </Link>
      )}

      {!m && s.target != null && (
        <div className="forecast" data-testid="forecast">
          <Icon name="clock" size={17} />
          <div className="grow">
            {f.status === 'ok' && f.date ? (
              <>
                Прогноз: <strong>{formatDate(f.date)}</strong>
                <span className="faint"> · вероятно {formatDate(f.early!)} — {f.late ? formatDate(f.late) : 'позже'}</span>
              </>
            ) : f.status === 'insufficient' ? (
              <>
                Прогноз появится, когда будет больше данных{f.needPoints > 0 ? `: ещё ${f.needPoints} измер.` : ''}
                {f.needSpanDays > 0 ? `${f.needPoints > 0 ? ' и' : ':'} ${nDays(f.needSpanDays)} наблюдений` : ''}.
              </>
            ) : f.status === 'reached' || s.progress?.state === 'reached' ? (
              <>Тренд достиг цели. Можно перейти в режим поддержания.</>
            ) : f.status === 'away' ? (
              <>Сейчас тренд направлен от цели — дату не прогнозируем.</>
            ) : f.status === 'flat' ? (
              <>Тренд стабилен — дату достижения пока не определить.</>
            ) : (
              <>При текущем темпе цель дальше, чем на 3 года.</>
            )}
          </div>
        </div>
      )}
      {s.progress?.state === 'regressed' && (
        <p className="small muted">Сейчас вес дальше от цели, чем на старте. Шкала покажет движение, как только тренд развернётся.</p>
      )}
    </section>
  );
}

/** Horizontal scale from the start weight to the target with the current position. */
function Journey({ start, target, fraction, left, reached }: { start: number; target: number; fraction: number; left: number; reached: boolean }) {
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
        <span>
          <span className="t-caption">Старт</span>
          <span className="num">{fmtKg(start)}</span>
        </span>
        <span className="journey-left">
          <span className="t-caption">Осталось</span>
          <span className="num strong" data-testid="left-kg">{reached ? 'Достигнута' : fmtKg(left)}</span>
        </span>
        <span className="end">
          <span className="t-caption">Цель</span>
          <span className="num">{fmtKg(target)}</span>
        </span>
      </div>
    </div>
  );
}

function QuickStats({ s }: { s: Summary }) {
  const tile = (label: string, v: number | null) => (
    <div className="qstat">
      <span className="t-caption">{label}</span>
      {v == null ? <span className="qstat-empty">Недостаточно данных</span> : <span className="qstat-value num">{fmtSigned(v, 2, 'кг')}</span>}
    </div>
  );
  return (
    <div className="qstats" aria-label="Краткая аналитика">
      {tile('За 7 дней', s.change7)}
      {tile('За 30 дней', s.change30)}
      <div className="qstat">
        <span className="t-caption">Последнее</span>
        <span className="qstat-value num">{fmtKg(s.latest!.value)}</span>
        <span className="qstat-sub">{ago(diffDays(today(), s.latest!.date))}</span>
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
            {s.current > 1 && (
              <span className="t-caption num" title="Дней подряд">
                {s.current} дн.
              </span>
            )}
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

function RecentAchievements({ data }: { data: AppData }) {
  const recent = [...data.achievements].sort((a, b) => b.date.localeCompare(a.date) || b.unlockedAt - a.unlockedAt).slice(0, 3);
  if (!recent.length) return null;
  return (
    <section className="section" aria-labelledby="ach-h">
      <div className="section-head">
        <h2 id="ach-h">Достижения</h2>
        <Link to="/achievements">Все</Link>
      </div>
      <div className="ach-strip">
        {recent.map((a) => {
          const def = ACHIEVEMENTS.find((x) => x.id === a.id);
          if (!def) return null;
          return (
            <div key={a.id} className="ach-mini">
              <span className="ach-mini-icon" aria-hidden="true">{def.icon}</span>
              <span className="ach-mini-title">{def.title}</span>
              <span className="t-caption">{formatDate(a.date)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
