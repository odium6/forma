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

  return (
    <div className="page">
      <PageHeader title="Достижения" subtitle={`Получено ${data.achievements.filter((a) => ACHIEVEMENTS.some((d) => d.id === a.id)).length} из ${ACHIEVEMENTS.length}`} />
      <section className="card level">
        <div className="level-badge num" aria-hidden="true">{lvl.level}</div>
        <div className="grow">
          <div className="eyebrow">Уровень {lvl.level}</div>
          <h2>{lvl.title}</h2>
          <div className="progress-bar" style={{ margin: '10px 0 6px' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lvl.fraction * 100)}>
            <span style={{ width: `${lvl.fraction * 100}%` }} />
          </div>
          <div className="small muted num">
            {points} очков{lvl.next ? ` · до уровня «${lvl.next.title}» ${lvl.next.left}` : ' · максимальный уровень'}
          </div>
        </div>
      </section>
      {(Object.keys(GROUPS) as AchievementGroup[]).map((g) => {
        const defs = ACHIEVEMENTS.filter((a) => a.group === g);
        return (
          <section key={g} className="stack" style={{ ['--gap' as string]: '10px' }}>
            <h2 className="group-title">{GROUPS[g]}</h2>
            <div className="ach-grid">
              {defs.map((a) => {
                const u = unlocked.get(a.id);
                const p = progress.get(a.id);
                return (
                  <article key={a.id} className={`card ach ${u ? 'got' : 'locked'}`} aria-label={`${a.title}${u ? ', получено' : ', не получено'}`}>
                    <div className="ach-icon" aria-hidden="true">{a.icon}</div>
                    <div className="grow">
                      <h3>{a.title}</h3>
                      <p className="small muted">{a.description}</p>
                      {u ? (
                        <p className="xs ach-date">Получено {formatDate(u.date)} · +{a.points}</p>
                      ) : p ? (
                        <div className="ach-prog">
                          <div className="progress-bar"><span style={{ width: `${(p[0] / p[1]) * 100}%` }} /></div>
                          <span className="xs faint num">{p[0]}/{p[1]}</span>
                        </div>
                      ) : (
                        <p className="xs faint">+{a.points} очков</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="small muted">Достижения начисляются только по реальным данным и датируются днём события. Полученные достижения сохраняются, даже если позже изменить цель.</p>
    </div>
  );
}
