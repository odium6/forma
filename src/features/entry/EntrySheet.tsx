import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { ISODate, MeasurementKey } from '@/domain/types';
import { addEntry, deleteEntry, updateEntry, useData } from '@/state/store';
import { formatDate, nowTime, today } from '@/lib/dates';
import { fmtKg, fmtNum, parseDecimal } from '@/lib/format';
import { LIMITS, TYPICAL, navyBodyFat } from '@/lib/math/body';
import { allMetricKeys, metricLabel } from '@/lib/metrics';
import { Sheet } from '@/ui/Sheet';
import { NumberField, fieldValid, Notice } from '@/ui/controls';
import { WeightWheel } from '@/ui/Wheel';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { skipToday } from '@/lib/push';
import './entry.css';

interface OpenOpts {
  date?: ISODate;
  entryId?: string;
  focus?: 'weight' | 'measurements' | 'note';
}

const Ctx = createContext<(o?: OpenOpts) => void>(() => {});

export function useOpenEntry() {
  return useContext(Ctx);
}

export function EntryProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OpenOpts | null>(null);
  const open = useCallback((o?: OpenOpts) => setOpts(o ?? {}), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {opts && <EntryForm key={`${opts.entryId ?? 'new'}-${opts.date ?? ''}-${opts.focus ?? ''}`} opts={opts} onClose={() => setOpts(null)} />}
    </Ctx.Provider>
  );
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

function EntryForm({ opts, onClose }: { opts: OpenOpts; onClose: () => void }) {
  const data = useData();
  const { toast, confirm } = useFeedback();
  const editing = opts.entryId ? data.entries.find((e) => e.id === opts.entryId) ?? null : null;
  const lastWeight = [...data.entries].reverse().find((e) => e.weight != null)?.weight ?? null;
  const mode: 'weight' | 'measurements' | 'note' = editing ? (editing.weight != null ? 'weight' : 'measurements') : (opts.focus ?? 'weight');

  const [date, setDate] = useState<ISODate>(editing?.date ?? opts.date ?? today());
  const [time, setTime] = useState(editing?.time ?? nowTime());
  const [weight, setWeight] = useState<number | null>(mode === 'weight' ? (editing?.weight ?? lastWeight ?? 70) : null);
  const [bodyFat, setBodyFat] = useState(str(editing?.bodyFat));
  const [note, setNote] = useState(editing?.note ?? '');
  const [meas, setMeas] = useState<Partial<Record<MeasurementKey, string>>>(() =>
    Object.fromEntries(Object.entries(editing?.measurements ?? {}).map(([k, v]) => [k, str(v)])),
  );
  const [showWhen, setShowWhen] = useState(false);
  const [showNote, setShowNote] = useState(mode === 'note' || !!editing?.note);
  const [showBody, setShowBody] = useState(mode === 'measurements' || (!!editing && (editing.bodyFat != null || Object.keys(editing.measurements).length > 0)));
  const [saving, setSaving] = useState(false);
  const keys = allMetricKeys(data.customMetrics);

  const parsedMeas = Object.fromEntries(
    Object.entries(meas)
      .map(([k, v]) => [k, parseDecimal(v ?? '')] as const)
      .filter(([, v]) => v != null),
  ) as Partial<Record<MeasurementKey, number>>;

  const allValid =
    fieldValid(bodyFat, LIMITS.bodyFat.min, LIMITS.bodyFat.max) &&
    Object.values(meas).every((v) => fieldValid(v ?? '', LIMITS.measurement.min, LIMITS.measurement.max));
  const hasContent = weight != null || parseDecimal(bodyFat) != null || Object.keys(parsedMeas).length > 0 || note.trim().length > 0;
  const isToday = date === today();
  // another weighing already on this day: the user chooses to replace it or keep both
  const sameDayWeight = !editing && weight != null ? [...data.entries].reverse().find((e) => e.date === date && e.weight != null) ?? null : null;
  const [dup, setDup] = useState<'replace' | 'add' | null>(null);
  const needsChoice = sameDayWeight != null && dup == null;
  const futureDate = date > today();
  const navy = data.profile ? navyBodyFat(data.profile.sex, data.profile.heightCm, parsedMeas.waist, parsedMeas.neck, parsedMeas.hips) : null;
  const bigJump = weight != null && lastWeight != null && !editing && Math.abs(weight - lastWeight) > 3;

  const save = async () => {
    if (!allValid || !hasContent || needsChoice) return;
    setSaving(true);
    try {
      const payload = { date, time, weight, bodyFat: parseDecimal(bodyFat), measurements: parsedMeas, note: note.trim().slice(0, 1000) };
      if (editing) {
        await updateEntry({ ...editing, ...payload });
        toast('Запись обновлена', { tone: 'success' });
      } else {
        if (sameDayWeight && dup === 'replace') {
          await updateEntry({ ...sameDayWeight, time, weight, bodyFat: payload.bodyFat ?? sameDayWeight.bodyFat, measurements: { ...sameDayWeight.measurements, ...payload.measurements }, note: payload.note || sameDayWeight.note });
        } else await addEntry(payload);
        toast(payload.weight != null ? `Сохранено: ${fmtKg(payload.weight)}` : 'Сохранено', { tone: 'success' });
      }
      onClose();
    } catch {
      toast('Не удалось сохранить. Проверь доступ к хранилищу браузера.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: 'Удалить запись?', text: `${formatDate(editing.date)}, ${editing.time}`, confirm: 'Удалить', danger: true });
    if (!ok) return;
    const backup = editing;
    await deleteEntry(editing.id);
    onClose();
    toast('Запись удалена', {
      action: {
        label: 'Вернуть',
        run: () => void addEntry({ date: backup.date, time: backup.time, weight: backup.weight, bodyFat: backup.bodyFat, measurements: backup.measurements, note: backup.note, source: backup.source }),
      },
    });
  };

  const title = editing ? 'Запись' : mode === 'note' ? 'Заметка' : mode === 'measurements' ? 'Параметры тела' : 'Вес';

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          {editing && (
            <button className="btn danger icon" onClick={remove} aria-label="Удалить запись">
              <Icon name="trash" size={20} />
            </button>
          )}
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!allValid || !hasContent || needsChoice || saving} onClick={save} data-testid="entry-save">
            Сохранить
          </button>
        </>
      }
    >
      <form
        className="stack entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <button type="button" className="when" aria-expanded={showWhen} onClick={() => setShowWhen((v) => !v)}>
          <Icon name="clock" size={16} />
          <span className="num">{isToday ? 'Сегодня' : formatDate(date, { weekday: true })}, {time}</span>
          <Icon name="down" size={15} style={{ transform: showWhen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
        </button>
        {showWhen && (
          <div className="grid-2 fade-up">
            <div className="field">
              <label htmlFor="entry-date">Дата</label>
              <input id="entry-date" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="entry-time">Время</label>
              <input id="entry-time" className="input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
            </div>
          </div>
        )}
        {futureDate && <Notice tone="warn">Это будущая дата.</Notice>}

        {weight != null ? (
          <>
            <WeightWheel value={weight} onChange={setWeight} />
            {bigJump && <p className="field-warn center">На {fmtNum(Math.abs(weight - lastWeight!), 2)} кг отличается от прошлого раза — проверь значение.</p>}
          </>
        ) : mode !== 'note' && editing ? (
          <button type="button" className="link-btn" onClick={() => setWeight(lastWeight ?? 70)}>+ Добавить вес</button>
        ) : null}
        {sameDayWeight && (
          <div className="dup-choice" role="group" aria-label="Вес за этот день уже есть">
            <p className="small">
              {isToday ? 'Сегодня' : formatDate(date)} уже внесён вес <span className="num strong">{fmtKg(sameDayWeight.weight!)}</span> в {sameDayWeight.time}.
            </p>
            <div className="dup-btns">
              <button type="button" className="chip" aria-pressed={dup === 'replace'} onClick={() => setDup('replace')} data-testid="dup-replace">Заменить</button>
              <button type="button" className="chip" aria-pressed={dup === 'add'} onClick={() => setDup('add')} data-testid="dup-add">Добавить новую запись</button>
            </div>
          </div>
        )}

        {mode !== 'note' && !showBody && (
          <button type="button" className="disclosure" onClick={() => setShowBody(true)}>
            <Icon name="ruler" size={18} />
            <span className="grow">Параметры тела</span>
            <Icon name="plus" size={16} />
          </button>
        )}
        {showBody && mode !== 'note' && (
          <div className="stack fade-up">
            <NumberField label="Процент жира" value={bodyFat} onChange={setBodyFat} suffix="%" min={LIMITS.bodyFat.min} typical={TYPICAL.bodyFat} max={LIMITS.bodyFat.max} />
            {navy != null && parseDecimal(bodyFat) == null && (
              <div className="row between navy">
                <span className="small">
                  По обхватам: <span className="num strong">{fmtNum(navy, 2)}%</span>
                </span>
                <button type="button" className="btn sm" onClick={() => setBodyFat(fmtNum(navy, 2))}>Подставить</button>
              </div>
            )}
            <div className="grid-2">
              {keys.map((k) => {
                const { label, unit } = metricLabel(k, data.customMetrics);
                return (
                  <NumberField
                    key={k}
                    label={label}
                    value={meas[k] ?? ''}
                    onChange={(v) => setMeas((m) => ({ ...m, [k]: v }))}
                    suffix={unit}
                    min={LIMITS.measurement.min}
                    typical={TYPICAL.measurement}
                    max={LIMITS.measurement.max}
                  />
                );
              })}
            </div>
          </div>
        )}

        {!showNote ? (
          <button type="button" className="disclosure" onClick={() => setShowNote(true)}>
            <Icon name="note" size={18} />
            <span className="grow">Заметка</span>
            <Icon name="plus" size={16} />
          </button>
        ) : (
          <div className="field">
            {mode !== 'note' && <label htmlFor="entry-note">Заметка</label>}
            <textarea id="entry-note" className="input" autoFocus={mode === 'note'} rows={mode === 'note' ? 5 : 3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Сон, самочувствие, тренировка…" aria-label="Заметка" />
          </div>
        )}
        {mode === 'weight' && !editing && isToday && (
          <button
            type="button"
            className="link-btn cant-today"
            onClick={async () => {
              await skipToday('weigh');
              toast('Хорошо, сегодня больше не напомню');
              onClose();
            }}
            data-testid="cant-today"
          >
            Сегодня не могу взвеситься
          </button>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
