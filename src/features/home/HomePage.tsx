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
import { ProgressRing } from '@/ui/controls';
import type { AppData } from '@/domain/types';
import './home.css';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export function HomePage() {
  const data = useData();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  const s = useMemo(() => computeSummary(data), [data]);
  const insights = useMemo(() => visibleInsights(data, undefined, 4), [data]);

  return (
    <div className="page home">
      <header className="page-head">
        <div className="grow">
          <p className="muted small">{formatDate(today(), { weekday: true })}</p>
          <h1>
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
            {
              label: data.settings.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема',
              icon: <Icon name={data.settings.theme === 'dark' ? 'sun' : 'moon'} size={18} />,
              onSelect: () => void saveSettings({ theme: data.settings.theme === 'dark' ? 'light' : 'dark' }),
            },
          ]}
        />
      </header>

      <div className="dash">
        <div className="col">
          <HeroCard s={s} />
          <section className="card" aria-labelledby="chart-h">
            <div className="card-head">
              <h2 id="chart-h">Динамика веса</h2>
              <Link to="/progress" className="small strong">Подробнее</Link>
            </div>
            {s.points.length ? (
              <WeightChart data={data} summary={s} height={240} />
            ) : (
              <div className="empty">
                <p className="small">График появится после первого измерения.</p>
                <button className="btn primary" onClick={() => openEntry()}>Внести вес</button>
              </div>
            )}
          </section>
        </div>
        <div className="col">
          <TodayCard data={data} />
          {insights.length > 0 && (
            <section className="card" aria-labelledby="ins-h">
              <div className="card-head">
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
  const latestAge = s.latest ? diffDays(today(), s.latest.date) : null;

  if (!s.points.length) {
    return (
      <section className="card hero hero-empty">
        <div className="eyebrow">Стартовая точка</div>
        <h2>Внеси первый вес</h2>
        <p className="muted">FORMA построит тренд, рассчитает прогресс и прогноз по твоим реальным измерениям.</p>
        <button className="btn primary lg" onClick={() => openEntry()}>
          <Icon name="plus" size={20} /> Внести данные
        </button>
      </section>
    );
  }

  const m = s.maintenance;
  const pct = s.progress ? Math.round(s.progress.fraction * 100) : null;

  return (
    <section className="card hero" aria-label="Прогресс к цели">
      <div className="hero-top">
        <span className={`badge ${status.tone === 'positive' ? 'positive' : status.tone === 'warn' ? 'warn' : ''}`} data-testid="status">
          {status.title}
        </span>
        {s.goal?.targetDate && !m && <span className="small muted">Срок: {formatDate(s.goal.targetDate)}</span>}
      </div>
      <div className="hero-main">
        {m ? (
          <MaintenanceBand s={s} />
        ) : (
          <ProgressRing value={s.progress?.fraction ?? 0} size={176} label={pct != null ? `Выполнено ${pct}% цели` : 'Цель не задана'}>
            <div className="ring-value num" data-testid="current-weight">{fmtNum(s.current!, 1)}</div>
            <div className="ring-unit">кг · тренд</div>
            {pct != null && <div className="ring-pct num">{pct}%</div>}
          </ProgressRing>
        )}
        <dl className="hero-stats">
          <div>
            <dt>Последнее</dt>
            <dd className="num">
              {fmtKg(s.latest!.value)}
              <span className="faint xs">{latestAge === 0 ? ' сегодня' : latestAge === 1 ? ' вчера' : ` ${nDays(latestAge!)} назад`}</span>
            </dd>
          </div>
          {m ? (
            <div>
              <dt>Диапазон</dt>
              <dd className="num">{fmtNum(m.low, 1)}–{fmtNum(m.high, 1)} кг</dd>
            </div>
          ) : s.target != null ? (
            <>
              <div>
                <dt>Цель</dt>
                <dd className="num">{fmtKg(s.target)}</dd>
              </div>
              <div>
                <dt>Осталось</dt>
                <dd className="num" data-testid="left-kg">{s.progress?.state === 'reached' ? 'Достигнута' : fmtKg(s.progress?.leftKg ?? Math.abs(s.target - s.current!))}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>Цель</dt>
              <dd><Link to="/settings#goal">Задать</Link></dd>
            </div>
          )}
          <div>
            <dt>7 дней</dt>
            <dd className="num">{s.change7 == null ? <span className="faint">мало данных</span> : fmtSigned(s.change7, 1, 'кг')}</dd>
          </div>
          <div>
            <dt>30 дней</dt>
            <dd className="num">{s.change30 == null ? <span className="faint">мало данных</span> : fmtSigned(s.change30, 1, 'кг')}</dd>
          </div>
        </dl>
      </div>
      {!m && s.target != null && (
        <div className="forecast" data-testid="forecast">
          <Icon name="target" size={18} />
          <div className="grow small">
            {f.status === 'ok' && f.date ? (
              <>
                Прогноз достижения: <strong>{formatDate(f.date)}</strong>
                <span className="muted">
                  {' '}
                  (вероятно {formatDate(f.early!)} — {f.late ? formatDate(f.late) : 'позже'}; темп {fmtSigned(f.kgPerWeek!, 2)} кг/нед, точность {f.confidence === 'high' ? 'высокая' : f.confidence === 'medium' ? 'средняя' : 'низкая'})
                </span>
              </>
            ) : f.status === 'insufficient' ? (
              <>Прогноз появится, когда будет больше данных{f.needPoints > 0 ? `: ещё ${f.needPoints} измер.` : ''}{f.needSpanDays > 0 ? `${f.needPoints > 0 ? ' и' : ':'} ${nDays(f.needSpanDays)} наблюдений` : ''}.</>
            ) : f.status === 'reached' || s.progress?.state === 'reached' ? (
              <>Тренд достиг цели. Можно перейти в режим поддержания в настройках цели.</>
            ) : f.status === 'away' ? (
              <>Сейчас тренд направлен от цели, поэтому дату не прогнозируем.</>
            ) : f.status === 'flat' ? (
              <>Тренд стабилен — при текущей динамике дату достижения не определить.</>
            ) : (
              <>При текущем темпе цель дальше, чем на 3 года — дату не показываем.</>
            )}
          </div>
        </div>
      )}
      {s.progress?.state === 'regressed' && (
        <p className="small muted">Сейчас вес дальше от цели, чем на старте. Прогресс не уходит в минус — шкала покажет движение, как только тренд развернётся.</p>
      )}
    </section>
  );
}

function MaintenanceBand({ s }: { s: Summary }) {
  const m = s.maintenance!;
  const span = m.high - m.low;
  const lo = m.low - span;
  const hi = m.high + span;
  const pos = Math.max(0, Math.min(1, (s.current! - lo) / (hi - lo)));
  return (
    <div className="mband" role="img" aria-label={`Текущий вес ${fmtNum(s.current!, 1)} кг, диапазон ${fmtNum(m.low, 1)}–${fmtNum(m.high, 1)} кг`}>
      <div className="ring-value num">{fmtNum(s.current!, 1)}</div>
      <div className="ring-unit">кг · тренд</div>
      <div className="mband-track">
        <span className="mband-zone" />
        <span className="mband-pin" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="small muted">
        {m.state === 'inside' ? 'Внутри целевого диапазона' : `${m.state === 'above' ? 'Выше' : 'Ниже'} диапазона на ${fmtKg(Math.abs(m.deviation))}`}
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
  const done = habits.filter((x) => x.s.todayDone).length;
  const newAch = data.achievements.filter((a) => diffDays(d, a.date) <= 1).length;

  return (
    <section className="card" aria-labelledby="today-h">
      <div className="card-head">
        <h2 id="today-h">Сегодня</h2>
        {habits.length > 0 && <span className="badge num">{done}/{habits.length}</span>}
      </div>
      <div className="list">
        <button className="list-item" onClick={() => openEntry()}>
          <span className={`check-dot ${weighed ? 'on' : ''}`}>{weighed && <Icon name="check" size={16} strokeWidth={2.6} />}</span>
          <span className="grow">{weighed ? 'Вес внесён' : 'Внести вес'}</span>
          <Icon name="right" size={18} className="faint" />
        </button>
        {habits.slice(0, 6).map(({ h, s }) => (
          <div key={h.id} className="list-item">
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
              {s.todayDone && <Icon name="check" size={16} strokeWidth={2.6} />}
            </button>
            <span className="grow">
              <span aria-hidden="true">{h.icon} </span>
              {h.name}
            </span>
            {s.current > 0 && (
              <span className="streak small num" title="Серия">
                <Icon name="flame" size={15} /> {s.current}
              </span>
            )}
          </div>
        ))}
        {habits.length === 0 && (
          <Link to="/habits" className="list-item">
            <span className="check-dot" />
            <span className="grow muted">Добавить привычку</span>
            <Icon name="right" size={18} className="faint" />
          </Link>
        )}
        {newAch > 0 && (
          <Link to="/achievements" className="list-item">
            <span className="list-icon">🏅</span>
            <span className="grow">Новых достижений: {newAch}</span>
            <Icon name="right" size={18} className="faint" />
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
    <section className="card" aria-labelledby="ach-h">
      <div className="card-head">
        <h2 id="ach-h">Последние достижения</h2>
        <Link to="/achievements" className="small strong">Все</Link>
      </div>
      <div className="list">
        {recent.map((a) => {
          const def = ACHIEVEMENTS.find((x) => x.id === a.id);
          if (!def) return null;
          return (
            <div key={a.id} className="list-item">
              <span className="list-icon">{def.icon}</span>
              <span className="grow">
                <span className="strong">{def.title}</span>
                <span className="small muted" style={{ display: 'block' }}>{formatDate(a.date)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
