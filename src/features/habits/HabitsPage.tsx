import { useMemo, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import type { AppData, Habit, HabitSchedule } from '@/domain/types';
import { deleteHabit, saveHabit, setHabitLog, useData } from '@/state/store';
import { addDays, formatDate, formatDateShort, rangeDays, startOfWeek, today, weekday, WEEKDAYS_SHORT } from '@/lib/dates';
import { HABIT_PRESETS, describeSchedule, habitStats, indexLogs, isDoneValue, isScheduledOn, logValue, withSchedule, type HabitStats, type LogIndex } from '@/lib/habits';
import { fmtPct, uid } from '@/lib/format';
import { EmptyState, NumberField, Segmented, fieldValid } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import './habits.css';

const ICONS = ['💧', '🥗', '🍎', '🥦', '🚫', '🥤', '🍔', '🍫', '🥐', '🏋️', '🏃', '🚶', '🧘', '🚴', '🏊', '👟', '🌙', '😴', '☀️', '📖', '💊', '🧠', '🫁', '❤️'];
const COLORS = ['#22a052', '#8cc21c', '#0f8a7a', '#5b7cfa', '#e8772e', '#d94f8a', '#9b5de5', '#c99a06'];

export default function HabitsPage() {
  const data = useData();
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const d = today();
  const idx = useMemo(() => indexLogs(data.habitLogs), [data.habitLogs]);
  const active = data.habits.filter((h) => !h.archivedAt);
  const archived = data.habits.filter((h) => h.archivedAt);
  const stats = new Map(active.map((h) => [h.id, habitStats(h, idx, d)]));
  const todayList = active.filter((h) => stats.get(h.id)!.todayScheduled);
  const other = active.filter((h) => !stats.get(h.id)!.todayScheduled);
  const done = todayList.filter((h) => stats.get(h.id)!.todayDone).length;
  const detailHabit = data.habits.find((h) => h.id === detail) ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Привычки"
        subtitle={todayList.length ? `Сегодня выполнено ${done} из ${todayList.length}` : 'Маленькие действия, которые складываются в форму'}
        actions={
          <button className="btn primary" onClick={() => setEditing('new')} data-testid="new-habit">
            <Icon name="plus" size={18} /> Привычка
          </button>
        }
      />
      {active.length === 0 ? (
        <section className="card">
          <EmptyState icon="habits" title="Добавь первую привычку" text="Например: пить воду, не есть фастфуд, тренироваться 3 раза в неделю." action={<button className="btn primary" onClick={() => setEditing('new')}>Создать привычку</button>} />
        </section>
      ) : (
        <div className="habit-grid">
          {[...todayList, ...other].map((h) => (
            <HabitCard key={h.id} habit={h} stats={stats.get(h.id)!} idx={idx} onOpen={() => setDetail(h.id)} />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <section className="card">
          <div className="card-head"><h3>Архив</h3></div>
          <div className="list">
            {archived.map((h) => (
              <button key={h.id} className="list-item" onClick={() => setDetail(h.id)}>
                <span className="list-icon">{h.icon}</span>
                <span className="grow">{h.name}</span>
                <span className="small faint">рекорд {h.bestStreak}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {editing && <HabitEditor habit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} count={data.habits.length} />}
      {detailHabit && <HabitDetail data={data} habit={detailHabit} idx={idx} onClose={() => setDetail(null)} onEdit={() => { setEditing(detailHabit); setDetail(null); }} />}
    </div>
  );
}

function HabitControl({ habit: h, date, value, compact }: { habit: Habit; date: string; value: number | undefined; compact?: boolean }) {
  const done = isDoneValue(h, value);
  if (h.kind === 'check') {
    return (
      <button
        className={`habit-check ${done ? 'on' : ''}`}
        style={{ ['--hc' as string]: h.color }}
        aria-pressed={done}
        aria-label={`${h.name}: ${done ? 'снять отметку' : 'отметить'}`}
        onClick={() => void setHabitLog(h.id, date, done ? null : 1)}
        data-testid={`habit-check-${h.name}`}
      >
        <Icon name="check" size={compact ? 18 : 22} strokeWidth={2.6} />
      </button>
    );
  }
  const v = value ?? 0;
  const step = h.target >= 1000 ? 500 : 1;
  return (
    <div className="stepper" style={{ ['--hc' as string]: h.color }}>
      <button aria-label="Меньше" onClick={() => void setHabitLog(h.id, date, v - step <= 0 && h.kind === 'count' ? null : Math.max(0, v - step))} disabled={value == null}>
        <Icon name="minus" size={18} />
      </button>
      <span className={`num stepper-val ${done ? 'on' : ''}`}>
        {value ?? '—'}
        <small>/{h.target}</small>
      </span>
      <button aria-label="Больше" onClick={() => void setHabitLog(h.id, date, value == null ? (h.kind === 'limit' ? 0 : step) : v + step)}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

function HabitCard({ habit: h, stats: s, idx, onOpen }: { habit: Habit; stats: HabitStats; idx: LogIndex; onOpen: () => void }) {
  const d = today();
  const week = rangeDays(addDays(d, -6), d);
  return (
    <article className={`card habit ${s.todayDone ? 'done' : ''}`} style={{ ['--hc' as string]: h.color }}>
      <div className="habit-top">
        <button className="habit-main" onClick={onOpen} aria-label={`Подробнее: ${h.name}`}>
          <span className="habit-icon" aria-hidden="true">{h.icon}</span>
          <span className="grow">
            <span className="habit-name">{h.name}</span>
            <span className="small muted">{describeSchedule(h.schedules[h.schedules.length - 1].schedule)}{h.kind !== 'check' ? ` · ${h.kind === 'limit' ? '≤' : ''}${h.target} ${h.unit}` : ''}</span>
          </span>
        </button>
        {s.todayScheduled ? <HabitControl habit={h} date={d} value={s.todayValue} /> : <span className="small faint">не сегодня</span>}
      </div>
      <div className="habit-foot">
        <div className="week-dots" aria-label="Последние 7 дней">
          {week.map((day) => {
            const sched = isScheduledOn(h, day);
            const ok = isDoneValue(h, logValue(idx, h.id, day));
            return (
              <span key={day} className={`wd ${ok ? 'ok' : sched ? (day === d ? 'pending' : 'miss') : 'off'}`} title={formatDateShort(day)}>
                {WEEKDAYS_SHORT[weekday(day)].slice(0, 1)}
              </span>
            );
          })}
        </div>
        <span className={`streak-pill ${s.current > 0 ? 'on' : ''}`} title={s.atRisk ? 'Один пропуск прощён — не пропусти следующий' : 'Текущая серия'}>
          <Icon name="flame" size={15} /> <span className="num">{s.current}</span>
          {s.unit === 'week' ? ' нед.' : ''}
          {s.atRisk && <span className="risk" aria-label="серия под угрозой">!</span>}
        </span>
      </div>
    </article>
  );
}

function HabitDetail({ data, habit: h, idx, onClose, onEdit }: { data: AppData; habit: Habit; idx: LogIndex; onClose: () => void; onEdit: () => void }) {
  const { confirm, toast } = useFeedback();
  const d = today();
  const s = habitStats(h, idx, d);
  const weeks = 12;
  const start = startOfWeek(addDays(d, -7 * (weeks - 1)));
  const days = rangeDays(start, addDays(startOfWeek(d), 6));
  const history = data.habitLogs.filter((l) => l.habitId === h.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  return (
    <Sheet
      open
      onClose={onClose}
      title={<>{h.icon} {h.name}</>}
      size="lg"
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirm({ title: 'Удалить привычку?', text: 'Вся история отметок этой привычки будет удалена без возможности восстановления. Можно вместо этого отправить её в архив.', danger: true, confirm: 'Удалить навсегда' })) {
                await deleteHabit(h.id);
                onClose();
                toast('Привычка удалена');
              }
            }}
          >
            Удалить
          </button>
          <button
            className="btn"
            onClick={async () => {
              await saveHabit({ ...h, archivedAt: h.archivedAt ? null : Date.now() });
              toast(h.archivedAt ? 'Привычка восстановлена' : 'Привычка в архиве; история сохранена');
              onClose();
            }}
          >
            {h.archivedAt ? 'Вернуть' : 'В архив'}
          </button>
          <button className="btn primary" onClick={onEdit}>Изменить</button>
        </>
      }
    >
      <div className="stat-row">
        <div><div className="stat-label">Серия</div><div className="stat-value num">{s.current}</div></div>
        <div><div className="stat-label">Рекорд</div><div className="stat-value num">{s.best}</div></div>
        <div><div className="stat-label">Всего</div><div className="stat-value num">{s.total}</div></div>
        <div><div className="stat-label">Неделя</div><div className="stat-value num">{s.weekRate == null ? '—' : fmtPct(s.weekRate)}</div></div>
        <div><div className="stat-label">Месяц</div><div className="stat-value num">{s.monthRate == null ? '—' : fmtPct(s.monthRate)}</div></div>
      </div>
      <p className="small muted">{describeSchedule(h.schedules[h.schedules.length - 1].schedule)}. Один случайный пропуск не прерывает серию.</p>
      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>12 недель — нажми на день, чтобы изменить отметку</div>
        <div className="heat" style={{ ['--hc' as string]: h.color }}>
          {WEEKDAYS_SHORT.map((w) => (
            <span key={w} className="heat-label">{w}</span>
          ))}
          {days.map((day) => {
            const v = logValue(idx, h.id, day);
            const ok = isDoneValue(h, v);
            const sched = isScheduledOn(h, day);
            const future = day > d;
            return (
              <button
                key={day}
                className={`heat-cell ${ok ? 'ok' : v != null ? 'partial' : sched && !future ? 'miss' : ''} ${future ? 'future' : ''}`}
                disabled={future || day < h.schedules[0].from}
                title={`${formatDate(day)}${v != null ? `: ${v}` : ''}`}
                aria-label={`${formatDate(day)}${ok ? ', выполнено' : ''}`}
                onClick={() => {
                  if (h.kind === 'check') void setHabitLog(h.id, day, ok ? null : 1);
                  else if (h.kind === 'count') void setHabitLog(h.id, day, ok ? null : h.target);
                  else void setHabitLog(h.id, day, v != null ? null : 0);
                }}
              />
            );
          })}
        </div>
      </div>
      {history.length > 0 && (
        <div>
          <div className="field-label" style={{ marginBottom: 4 }}>Последние отметки</div>
          <div className="list">
            {history.map((l) => (
              <div key={l.id} className="list-item" style={{ minHeight: 44, padding: '8px 0' }}>
                <span className="grow small">{formatDate(l.date, { weekday: true })}</span>
                {h.kind !== 'check' && <span className="num small">{l.value} {h.unit}</span>}
                <span className={`badge ${isDoneValue(h, l.value) ? 'positive' : ''}`}>{isDoneValue(h, l.value) ? 'выполнено' : 'частично'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

type SchedType = HabitSchedule['type'];

function HabitEditor({ habit, onClose, count }: { habit: Habit | null; onClose: () => void; count: number }) {
  const { toast } = useFeedback();
  const cur = habit?.schedules[habit.schedules.length - 1].schedule;
  const [name, setName] = useState(habit?.name ?? '');
  const [icon, setIcon] = useState(habit?.icon ?? '💧');
  const [color, setColor] = useState(habit?.color ?? COLORS[count % COLORS.length]);
  const [kind, setKind] = useState<Habit['kind']>(habit?.kind ?? 'check');
  const [target, setTarget] = useState(String(habit?.target ?? 8));
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [type, setType] = useState<SchedType>(cur?.type ?? 'daily');
  const [days, setDays] = useState<number[]>(cur?.type === 'weekdays' ? cur.days : [0, 1, 2, 3, 4]);
  const [times, setTimes] = useState(String(cur?.type === 'timesPerWeek' ? cur.times : 3));

  const schedule: HabitSchedule = type === 'daily' ? { type } : type === 'weekdays' ? { type, days: [...days].sort() } : { type, times: Number(times) };
  const valid = name.trim().length > 0 && (kind === 'check' || fieldValid(target, kind === 'limit' ? 0 : 1, 100000, true)) && (type !== 'weekdays' || days.length > 0) && (type !== 'timesPerWeek' || fieldValid(times, 1, 7, true));

  const save = async () => {
    if (!valid) return;
    const d = today();
    const base: Habit = habit ?? { id: uid(), name: '', icon, color, kind, target: 1, unit: '', schedules: [{ from: d, schedule }], createdAt: Date.now(), archivedAt: null, bestStreak: 0, order: count };
    const changed = habit && JSON.stringify(cur) !== JSON.stringify(schedule);
    await saveHabit({
      ...base,
      name: name.trim().slice(0, 60),
      icon,
      color,
      kind,
      target: kind === 'check' ? 1 : Number(target.replace(',', '.')),
      unit: kind === 'check' ? '' : unit.trim().slice(0, 16),
      schedules: changed ? withSchedule(habit, schedule, d) : base.schedules,
    });
    toast(habit ? 'Привычка обновлена' : 'Привычка создана', { tone: 'success' });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={habit ? 'Изменить привычку' : 'Новая привычка'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid} onClick={save} data-testid="habit-save">Сохранить</button>
        </>
      }
    >
      {!habit && (
        <div className="field">
          <span className="field-label">Быстрый старт</span>
          <div className="chips">
            {HABIT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="chip"
                onClick={() => {
                  setName(p.name);
                  setIcon(p.icon);
                  setKind(p.kind);
                  setTarget(String(p.target));
                  setUnit(p.unit);
                }}
              >
                {p.icon} {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="h-name">Название</label>
        <input id="h-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: 10 минут растяжки" data-testid="habit-name" />
      </div>
      <div className="field">
        <span className="field-label">Иконка и цвет</span>
        <div className="icon-pick" role="group" aria-label="Иконка">
          {ICONS.map((i) => (
            <button key={i} type="button" aria-pressed={icon === i} onClick={() => setIcon(i)}>{i}</button>
          ))}
        </div>
        <div className="color-pick" role="group" aria-label="Цвет">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={color === c} aria-label={`Цвет ${c}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Тип</span>
        <Segmented label="Тип привычки" value={kind} onChange={setKind} items={[{ value: 'check', label: 'Да / нет' }, { value: 'count', label: 'Количество' }, { value: 'limit', label: 'Лимит' }]} />
        <span className="field-hint">
          {kind === 'check' ? 'Отмечаешь выполнение одним касанием.' : kind === 'count' ? 'Выполнено, когда достигнута цель (например, 8 стаканов воды).' : 'Выполнено, если значение не больше лимита (например, сладкое ≤ 1 раза).'}
        </span>
      </div>
      {kind !== 'check' && (
        <div className="grid-2">
          <NumberField label={kind === 'limit' ? 'Лимит' : 'Цель в день'} value={target} onChange={setTarget} min={kind === 'limit' ? 0 : 1} max={100000} required />
          <div className="field">
            <label htmlFor="h-unit">Единица</label>
            <input id="h-unit" className="input" maxLength={16} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="стаканов" />
          </div>
        </div>
      )}
      <div className="field">
        <span className="field-label">Расписание</span>
        <Segmented label="Расписание" value={type} onChange={setType} items={[{ value: 'daily', label: 'Каждый день' }, { value: 'weekdays', label: 'По дням' }, { value: 'timesPerWeek', label: 'N в неделю' }]} />
        {type === 'weekdays' && (
          <div className="chips" style={{ marginTop: 8 }}>
            {WEEKDAYS_SHORT.map((w, i) => (
              <button key={w} type="button" className="chip" aria-pressed={days.includes(i)} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>
                {w}
              </button>
            ))}
          </div>
        )}
        {type === 'timesPerWeek' && <NumberField label="Раз в неделю" value={times} onChange={setTimes} min={1} max={7} required />}
        {habit && JSON.stringify(cur) !== JSON.stringify(schedule) && (
          <span className="field-hint">Новое расписание действует с сегодняшнего дня. Прошлые дни и рекорд серии не пересчитываются.</span>
        )}
      </div>
    </Sheet>
  );
}

export { HabitControl };
