import { useMemo } from 'react';
import { PageHeader } from '@/app/Layout';
import { useData } from '@/state/store';
import { ACHIEVEMENTS, achievementProgress, levelFor, totalPoints, type AchievementGroup } from '@/lib/achievements';
import { formatDate } from '@/lib/dates';
import './achievements.css';

const GROUPS: Record<AchievementGroup, string> = {
  start: 'Начало пути',
  regularity: 'Регулярность',
  progress: 'Прогресс',
  goal: 'Цели',
  habits: 'Привычки',
  photos: 'Фотодневник',
};

export default function AchievementsPage() {
  const data = useData();
  const unlocked = new Map(data.achievements.map((a) => [a.id, a]));
  const points = totalPoints(data.achievements);
  const lvl = levelFor(points);
  const progress = useMemo(() => new Map(ACHIEVEMENTS.map((a) => [a.id, achievementProgress(data, a)])), [data]);
  const got = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).sort((a, b) => unlocked.get(b.id)!.date.localeCompare(unlocked.get(a.id)!.date));
  const ahead = ACHIEVEMENTS.filter((a) => !unlocked.has(a.id));

  return (
    <div className="page">
      <PageHeader title="Достижения" subtitle={`Получено ${got.length} из ${ACHIEVEMENTS.length}`} />
      <section className="level" aria-label={`Уровень ${lvl.level}: ${lvl.title}`}>
        <div className="row between">
          <span className="small">
            <span className="muted">Уровень {lvl.level} · </span>
            <span className="strong">{lvl.title}</span>
          </span>
          <span className="xs faint num">{lvl.next ? `до «${lvl.next.title}» ${lvl.next.left}` : 'максимальный уровень'}</span>
        </div>
        <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lvl.fraction * 100)}>
          <span style={{ width: `${lvl.fraction * 100}%` }} />
        </div>
      </section>

      {got.length > 0 && (
        <section className="section">
          <h2 className="group-title">Получено</h2>
          <div className="group">
            {got.map((a) => (
              <article key={a.id} className="list-item ach got" aria-label={`${a.title}, получено`}>
                <span className="ach-icon" aria-hidden="true">{a.icon}</span>
                <span className="list-text">
                  <span className="list-title">{a.title}</span>
                  <span className="list-sub">{a.description}</span>
                </span>
                <span className="xs faint ach-date">{formatDate(unlocked.get(a.id)!.date)}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {(Object.keys(GROUPS) as AchievementGroup[]).map((g) => {
        const defs = ahead.filter((a) => a.group === g);
        if (!defs.length) return null;
        return (
          <section key={g} className="section">
            <h2 className="group-title">Впереди · {GROUPS[g]}</h2>
            <div className="group">
              {defs.map((a) => {
                const p = progress.get(a.id);
                return (
                  <article key={a.id} className="list-item ach locked" aria-label={`${a.title}, не получено`}>
                    <span className="ach-icon" aria-hidden="true">{a.icon}</span>
                    <span className="list-text">
                      <span className="list-title">{a.title}</span>
                      <span className="list-sub">{a.description}</span>
                      {p && (
                        <span className="ach-prog">
                          <span className="progress-bar"><span style={{ width: `${Math.min(100, (p[0] / p[1]) * 100)}%` }} /></span>
                          <span className="xs faint num">{p[0]}/{p[1]}</span>
                        </span>
                      )}
                    </span>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
