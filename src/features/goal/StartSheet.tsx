import { useState } from 'react';
import type { Goal, ISODate, MeasurementKey } from '@/domain/types';
import { addEntry, updateEntry, updateGoal, useData } from '@/state/store';
import { formatDate, today } from '@/lib/dates';
import { parseDecimal } from '@/lib/format';
import { LIMITS, TYPICAL } from '@/lib/math/body';
import { allMetricKeys, metricLabel } from '@/lib/metrics';
import { Sheet } from '@/ui/Sheet';
import { NumberField, Notice, fieldValid } from '@/ui/controls';
import { WeightWheel } from '@/ui/Wheel';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

/**
 * Edit the goal's starting point: date, weight and body measurements on that date.
 * The values are also written to the history as a regular entry for that day, so charts agree.
 */
export function StartSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const data = useData();
  const { toast } = useFeedback();
  const entryOn = (d: ISODate) => data.entries.find((e) => e.date === d) ?? null;
  const initial = entryOn(goal.startDate);

  const [date, setDate] = useState<ISODate>(goal.startDate);
  const [weight, setWeight] = useState<number>(goal.startWeight);
  const [bodyFat, setBodyFat] = useState(str(initial?.bodyFat));
  const [meas, setMeas] = useState<Partial<Record<MeasurementKey, string>>>(() => Object.fromEntries(Object.entries(initial?.measurements ?? {}).map(([k, v]) => [k, str(v)])));
  const [showBody, setShowBody] = useState(!!initial && (initial.bodyFat != null || Object.keys(initial.measurements).length > 0));
  const [saving, setSaving] = useState(false);
  const keys = allMetricKeys(data.customMetrics);

  const pickDate = (d: ISODate) => {
    setDate(d);
    const e = entryOn(d);
    if (e?.weight != null) setWeight(e.weight);
    if (e) {
      setBodyFat(str(e.bodyFat));
      setMeas(Object.fromEntries(Object.entries(e.measurements).map(([k, v]) => [k, str(v)])));
    }
  };

  const valid = fieldValid(bodyFat, LIMITS.bodyFat.min, LIMITS.bodyFat.max) && Object.values(meas).every((v) => fieldValid(v ?? '', LIMITS.measurement.min, LIMITS.measurement.max));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const measurements = Object.fromEntries(
        Object.entries(meas)
          .map(([k, v]) => [k, parseDecimal(v ?? '')] as const)
          .filter(([, v]) => v != null),
      ) as Partial<Record<MeasurementKey, number>>;
      const bf = parseDecimal(bodyFat);
      await updateGoal({ ...goal, startDate: date, startWeight: weight });
      const existing = entryOn(date);
      if (existing) await updateEntry({ ...existing, weight, bodyFat: bf ?? existing.bodyFat, measurements: { ...existing.measurements, ...measurements } });
      else await addEntry({ date, time: '08:00', weight, bodyFat: bf, measurements, note: '' });
      toast('Стартовая точка обновлена', { tone: 'success' });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Старт"
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid || saving} onClick={save} data-testid="start-save">Сохранить</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="start-date">Дата старта</label>
        <input id="start-date" className="input" type="date" value={date} onChange={(e) => e.target.value && pickDate(e.target.value)} data-testid="start-date" />
        {entryOn(date) && <span className="field-hint">За {formatDate(date)} уже есть запись — она обновится.</span>}
      </div>
      {date > today() && <Notice tone="warn">Это будущая дата.</Notice>}
      <WeightWheel value={weight} onChange={setWeight} />
      {!showBody ? (
        <button type="button" className="disclosure" onClick={() => setShowBody(true)}>
          <Icon name="ruler" size={18} />
          <span className="grow">Параметры тела на старте</span>
          <Icon name="plus" size={16} />
        </button>
      ) : (
        <div className="stack fade-up">
          <NumberField label="Процент жира" value={bodyFat} onChange={setBodyFat} suffix="%" min={LIMITS.bodyFat.min} typical={TYPICAL.bodyFat} max={LIMITS.bodyFat.max} />
          <div className="grid-2">
            {keys.map((k) => {
              const { label, unit } = metricLabel(k, data.customMetrics);
              return <NumberField key={k} label={label} value={meas[k] ?? ''} onChange={(v) => setMeas((m) => ({ ...m, [k]: v }))} suffix={unit} min={LIMITS.measurement.min} typical={TYPICAL.measurement} max={LIMITS.measurement.max} />;
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
