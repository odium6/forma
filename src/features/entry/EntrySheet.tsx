import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ISODate, MeasurementKey } from '@/domain/types';
import { addEntry, deleteEntry, updateEntry, useData } from '@/state/store';
import { formatDate, nowTime, today } from '@/lib/dates';
import { fmtKg, fmtNum, parseDecimal } from '@/lib/format';
import { LIMITS, TYPICAL, navyBodyFat } from '@/lib/math/body';
import { allMetricKeys, MEASUREMENT_HINTS, metricLabel } from '@/lib/metrics';
import { Sheet } from '@/ui/Sheet';
import { NumberField, fieldValid, Notice, ChipGroup } from '@/ui/controls';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import './entry.css';

interface OpenOpts {
  date?: ISODate;
  entryId?: string;
  focus?: 'weight' | 'measurements';
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
      {opts && <EntryForm key={`${opts.entryId ?? 'new'}-${opts.date ?? ''}`} opts={opts} onClose={() => setOpts(null)} />}
    </Ctx.Provider>
  );
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

function EntryForm({ opts, onClose }: { opts: OpenOpts; onClose: () => void }) {
  const data = useData();
  const { toast, confirm } = useFeedback();
  const editing = opts.entryId ? data.entries.find((e) => e.id === opts.entryId) ?? null : null;
  const lastWeight = [...data.entries].reverse().find((e) => e.weight != null)?.weight ?? null;

  const [date, setDate] = useState<ISODate>(editing?.date ?? opts.date ?? today());
  const [time, setTime] = useState(editing?.time ?? nowTime());
  const [weight, setWeight] = useState(str(editing?.weight));
  const [bodyFat, setBodyFat] = useState(str(editing?.bodyFat));
  const [note, setNote] = useState(editing?.note ?? '');
  const [meas, setMeas] = useState<Partial<Record<MeasurementKey, string>>>(() =>
    Object.fromEntries(Object.entries(editing?.measurements ?? {}).map(([k, v]) => [k, str(v)])),
  );
  const [showMore, setShowMore] = useState(opts.focus === 'measurements' || !!editing && (editing.bodyFat != null || Object.keys(editing.measurements).length > 0));
  const [dupAction, setDupAction] = useState<'replace' | 'add' | null>('add');
  const [saving, setSaving] = useState(false);

  const sameDay = useMemo(() => data.entries.filter((e) => e.date === date && e.id !== editing?.id), [data.entries, date, editing]);
  const keys = allMetricKeys(data.customMetrics);

  const parsedMeas = Object.fromEntries(
    Object.entries(meas)
      .map(([k, v]) => [k, parseDecimal(v ?? '')] as const)
      .filter(([, v]) => v != null),
  ) as Partial<Record<MeasurementKey, number>>;

  const allValid =
    fieldValid(weight, LIMITS.weight.min, LIMITS.weight.max) &&
    fieldValid(bodyFat, LIMITS.bodyFat.min, LIMITS.bodyFat.max) &&
    Object.values(meas).every((v) => fieldValid(v ?? '', LIMITS.measurement.min, LIMITS.measurement.max));
  const hasValue = parseDecimal(weight) != null || parseDecimal(bodyFat) != null || Object.keys(parsedMeas).length > 0;
  const needsDupChoice = !editing && sameDay.length > 0 && dupAction == null;
  const futureDate = date > today();

  const navy = data.profile ? navyBodyFat(data.profile.sex, data.profile.heightCm, parsedMeas.waist, parsedMeas.neck, parsedMeas.hips) : null;
  const w = parseDecimal(weight);
  const bigJump = w != null && lastWeight != null && !editing && Math.abs(w - lastWeight) > 3;

  const save = async () => {
    if (!allValid || !hasValue || needsDupChoice) return;
    setSaving(true);
    try {
      const payload = { date, time, weight: parseDecimal(weight), bodyFat: parseDecimal(bodyFat), measurements: parsedMeas, note: note.trim().slice(0, 1000) };
      if (editing) {
        await updateEntry({ ...editing, ...payload });
        toast('Запись обновлена', { tone: 'success' });
      } else if (dupAction === 'replace' && sameDay.length) {
        const target = sameDay[sameDay.length - 1];
        // keep values the user didn't re-enter
        await updateEntry({
          ...target,
          time,
          weight: payload.weight ?? target.weight,
          bodyFat: payload.bodyFat ?? target.bodyFat,
          measurements: { ...target.measurements, ...payload.measurements },
          note: payload.note || target.note,
        });
        toast('Запись за этот день обновлена', { tone: 'success' });
      } else {
        await addEntry(payload);
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
    const ok = await confirm({ title: 'Удалить запись?', text: `Запись от ${formatDate(editing.date)}, ${editing.time} будет удалена.`, confirm: 'Удалить', danger: true });
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

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Редактировать запись' : 'Внести данные'}
      footer={
        <>
          {editing && (
            <button className="btn danger icon" onClick={remove} aria-label="Удалить запись">
              <Icon name="trash" size={20} />
            </button>
          )}
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!allValid || !hasValue || needsDupChoice || saving} onClick={save} data-testid="entry-save">
            Сохранить
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <NumberField
          label="Вес"
          big
          value={weight}
          onChange={setWeight}
          suffix="кг"
          min={LIMITS.weight.min} typical={TYPICAL.weight}
          max={LIMITS.weight.max}
          placeholder={lastWeight != null ? fmtNum(lastWeight, 2) : '0,0'}
          autoFocus={opts.focus !== 'measurements'}
          testId="entry-weight"
          hint={lastWeight != null ? `Последний раз: ${fmtKg(lastWeight)}` : 'Можно внести только вес — остальное необязательно'}
        />
        {bigJump && (
          <Notice tone="warn">Разница с прошлым измерением больше 3 кг. Проверь значение — если всё верно, это может быть колебание воды.</Notice>
        )}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="entry-date">Дата</label>
            <input id="entry-date" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="entry-time">Время</label>
            <input id="entry-time" className="input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
          </div>
        </div>
        {futureDate && <Notice tone="warn">Это будущая дата — проверь, всё ли верно.</Notice>}

        {needsDupChoice || (!editing && sameDay.length > 0) ? (
          <div className="dup">
            <Notice tone="info">
              За {formatDate(date)} уже есть {sameDay.length === 1 ? 'запись' : `${sameDay.length} записи`} ({sameDay.map((e) => `${e.time}${e.weight != null ? ` · ${fmtKg(e.weight)}` : ''}`).join(', ')}). Что сделать?
            </Notice>
            <ChipGroup
              label="Действие с записью за день"
              value={dupAction ?? ('' as 'replace')}
              onChange={(v) => setDupAction(v as 'replace' | 'add')}
              options={[
                { value: 'replace', label: 'Обновить существующую' },
                { value: 'add', label: 'Добавить ещё одно измерение' },
              ]}
            />
            {dupAction === 'add' && <span className="field-hint">Несколько взвешиваний за день усредняются в графиках и прогнозе.</span>}
          </div>
        ) : null}

        <button type="button" className="disclosure" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
          <Icon name="ruler" size={19} />
          <span className="grow">Процент жира и измерения тела</span>
          <Icon name="down" size={18} style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
        </button>
        {showMore && (
          <div className="stack fade-up">
            <NumberField label="Процент жира" value={bodyFat} onChange={setBodyFat} suffix="%" min={LIMITS.bodyFat.min} typical={TYPICAL.bodyFat} max={LIMITS.bodyFat.max} hint="Со смарт-весов, калипера или по формуле ниже" />
            {navy != null && parseDecimal(bodyFat) == null && (
              <div className="row between navy">
                <span className="small">
                  Оценка по обхватам (метод ВМС США): <span className="num strong">{fmtNum(navy, 2)}%</span>
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
                    min={LIMITS.measurement.min} typical={TYPICAL.measurement}
                    max={LIMITS.measurement.max}
                    hint={k in MEASUREMENT_HINTS ? MEASUREMENT_HINTS[k as keyof typeof MEASUREMENT_HINTS] : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="entry-note">Заметка</label>
          <textarea id="entry-note" className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Самочувствие, сон, тренировка, особенности питания…" />
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
