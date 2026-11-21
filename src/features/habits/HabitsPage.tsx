import { useMemo, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import type { AppData, Habit, HabitSchedule } from '@/domain/types';
import { deleteHabit, deleteReminder, saveHabit, saveReminder, setHabitLog, useData } from '@/state/store';
import { addDays, formatDate, formatDateShort, rangeDays, startOfWeek, today, weekday, WEEKDAYS_SHORT } from '@/lib/dates';
import { HABIT_PRESETS, describeSchedule, habitStats, indexLogs, isDoneValue, isScheduledOn, logValue, withSchedule, type HabitStats, type LogIndex } from '@/lib/habits';
import { fmtPct, uid } from '@/lib/format';
import { EmptyState, NumberField, Segmented, ToggleRow, fieldValid } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { Flame } from '@/ui/Flame';
import './habits.css';

const ICONS = ['💧', '🥗', '🍎', '🥦', '🚫', '🥤', '🍔', '🍫', '🥐', '🏋️', '🏃', '🚶', '🧘', '🚴', '🏊', '👟', '🌙', '😴', '☀️', '📖', '💊', '🧠', '🫁', '❤️'];
const COLORS = ['#269b65', '#8fbf3b', '#2a9d8f', '#4f6fd8', '#c26a2e', '#c2577f', '#8a63d2', '#b8922a'];

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
        actions={
          <button className="btn primary icon" aria-label="Новая привычка" onClick={() => setEditing('new')} data-testid="new-habit">
            <Icon name="plus" size={22} />
          </button>
        }
      />
      {todayList.length > 0 && (
        <div className="habits-today" aria-label={`Сегодня выполнено ${done} из ${todayList.length}`}>
          <div className="row between">
            <span className="small muted">Сегодня</span>
            <span className="num strong">{done} из {todayList.length}</span>
          </div>
          <div className="progress-bar"><span style={{ width: `${(done / todayList.length) * 100}%` }} /></div>
        </div>
      )}
      {active.length === 0 ? (
        <section className="card">
          <EmptyState icon="habits" title="Добавь первую привычку" text="Например: пить воду, не есть фастфуд, тренироваться 3 раза в неделю." action={<button className="btn primary" onClick={() => setEditing('new')}>Создать привычку</button>} />
        </section>
      ) : (
        <div className="habit-sections">
          {todayList.length > 0 && (
            <section className="section">
              <h2 className="group-title">На сегодня</h2>
              <div className="group habit-list">
                {todayList.map((h) => (
                  <HabitCard key={h.id} habit={h} stats={stats.get(h.id)!} idx={idx} onOpen={() => setDetail(h.id)} />
                ))}
              </div>
            </section>
          )}
          {other.length > 0 && (
            <section className="section">
              <h2 className="group-title">В другие дни</h2>
              <div className="group habit-list">
                {other.map((h) => (
                  <HabitCard key={h.id} habit={h} stats={stats.get(h.id)!} idx={idx} onOpen={() => setDetail(h.id)} />
                ))}
              </div>
            </section>
          )}
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
  const week = rangeDays(startOfWeek(d), addDays(startOfWeek(d), 6));
  const doneWeek = week.filter((day) => isDoneValue(h, logValue(idx, h.id, day))).length;
  const sched = describeSchedule(h.schedules[h.schedules.length - 1].schedule);
  return (
    <article className={`habit-row ${s.todayDone ? 'done' : ''}`} style={{ ['--hc' as string]: h.color }}>
      <button className="habit-main" onClick={onOpen} aria-label={`Подробнее: ${h.name}`}>
        <span className="habit-icon" aria-hidden="true">{h.icon}</span>
        <span className="habit-text">
          <span className="habit-name">{h.name}</span>
          <span className="habit-sub">
            {sched}
            {h.kind !== 'check' ? ` · ${h.kind === 'limit' ? '≤ ' : ''}${h.target} ${h.unit}` : ''}
          </span>
          <span className="week-dots" aria-label={`На этой неделе выполнено: ${doneWeek}`}>
            {week.map((day) => {
              const on = isScheduledOn(h, day);
              const ok = isDoneValue(h, logValue(idx, h.id, day));
              return (
                <span key={day} className={`wd ${ok ? 'ok' : day > d ? 'future' : on ? (day === d ? 'pending' : 'miss') : 'off'}`} title={`${WEEKDAYS_SHORT[weekday(day)]}, ${formatDateShort(day)}`} />
              );
            })}
          </span>
        </span>
      </button>
      {s.current > 0 && (
        <span className="habit-flame num" aria-label={`${s.current} ${s.unit === 'week' ? 'нед.' : 'дн.'} подряд`}>
          <Flame size={16} /> {s.current}
        </span>
      )}
      {s.todayScheduled ? <HabitControl habit={h} date={d} value={s.todayValue} compact /> : <span className="xs faint">не сегодня</span>}
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
                const rem = data.reminders.find((r) => r.habitId === h.id);
                if (rem) await deleteReminder(rem.id);
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
        <div><div className="stat-label">Подряд</div><div className="stat-value num">{s.current}</div></div>
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
  const { reminders } = useData();
  const existingRem = habit ? reminders.find((r) => r.habitId === habit.id) ?? null : null;
  const [remind, setRemind] = useState(existingRem?.enabled ?? false);
  const [remTime, setRemTime] = useState(existingRem?.time ?? '20:00');
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
  const [pickIcon, setPickIcon] = useState(false);

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
    const label = `🔥 ${name.trim().slice(0, 60)}`;
    if (remind) {
      const days = schedule.type === 'weekdays' ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
      await saveReminder({ id: existingRem?.id ?? uid(), enabled: true, label, kind: 'custom', time: remTime, days, parity: 'all', createdAt: existingRem?.createdAt ?? Date.now(), habitId: base.id });
    } else if (existingRem) {
      await deleteReminder(existingRem.id);
    }
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
        <div className="row look-row">
          <button type="button" className="habit-icon big" style={{ ['--hc' as string]: color }} aria-expanded={pickIcon} aria-label={`Иконка ${icon}. Сменить`} onClick={() => setPickIcon((v) => !v)}>
            {icon}
          </button>
          <div className="color-pick" role="group" aria-label="Цвет">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-pressed={color === c} aria-label={`Цвет ${c}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        {pickIcon && (
          <div className="icon-pick fade-up" role="group" aria-label="Иконка">
            {ICONS.map((i) => (
              <button key={i} type="button" aria-pressed={icon === i} onClick={() => { setIcon(i); setPickIcon(false); }}>{i}</button>
            ))}
          </div>
        )}
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
      <ToggleRow icon="bell" title="Напоминать, чтобы огонёк не погас" checked={remind} onChange={setRemind} />
      {remind && (
        <div className="field fade-up">
          <label htmlFor="h-rem">Время напоминания</label>
          <input id="h-rem" className="input" type="time" value={remTime} onChange={(e) => e.target.value && setRemTime(e.target.value)} />
        </div>
      )}
    </Sheet>
  );
}

export { HabitControl };
