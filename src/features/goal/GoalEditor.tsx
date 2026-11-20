import { useMemo } from 'react';
import type { BodyShapeGoal, ISODate, Profile } from '@/domain/types';
import { ageFromBirthYear, formatDate, today } from '@/lib/dates';
import { fmtKg, fmtNum, parseDecimal } from '@/lib/format';
import { evaluateGoal, goalDirection, PACE, type GoalEvaluation } from '@/lib/math/goals';
import { healthyWeightRange, LIMITS, TYPICAL } from '@/lib/math/body';
import { NumberField, Notice, Segmented, fieldValid } from '@/ui/controls';
import './goal.css';

export type GoalMode = 'loss' | 'gain' | 'maintain';
export type PaceKey = 'calm' | 'moderate' | 'active';

export interface GoalDraft {
  mode: GoalMode;
  target: string;
  date: ISODate | '';
  pace: PaceKey;
  bodyFat: string;
  tolerance: string;
}

export const SHAPES: { value: BodyShapeGoal; title: string; hint: string; icon: string }[] = [
  { value: 'leaner', title: 'Стройнее', hint: 'Меньше объёмов, больше рельефа', icon: '🌿' },
  { value: 'athletic', title: 'Спортивнее', hint: 'Подтянутость и выносливость', icon: '🏃' },
  { value: 'stronger', title: 'Сильнее', hint: 'Больше мышц и силы', icon: '💪' },
  { value: 'healthier', title: 'Самочувствие', hint: 'Энергия, сон, здоровье', icon: '🫀' },
  { value: 'maintain', title: 'Сохранить форму', hint: 'Удержать то, что есть', icon: '⚖️' },
  { value: 'custom', title: 'Своё', hint: 'Опиши своими словами', icon: '✍️' },
];

export function paceValue(mode: GoalMode, pace: PaceKey, isMinor: boolean): number {
  if (mode === 'gain') return { calm: PACE.gain.comfortable, moderate: PACE.gain.ambitious, active: PACE.gain.max }[pace];
  if (isMinor) return { calm: 0.25, moderate: 0.35, active: PACE.minorLossMax }[pace];
  return { calm: PACE.loss.comfortable, moderate: PACE.loss.ambitious, active: PACE.loss.max }[pace];
}

export function useGoalEvaluation(draft: GoalDraft, profile: Pick<Profile, 'sex' | 'birthYear' | 'heightCm'> | null, currentWeight: number | null): GoalEvaluation | null {
  return useMemo(() => {
    const t = parseDecimal(draft.target);
    if (!profile || currentWeight == null || draft.mode === 'maintain' || t == null || !fieldValid(draft.target, LIMITS.weight.min, LIMITS.weight.max)) return null;
    return evaluateGoal({
      sex: profile.sex,
      age: ageFromBirthYear(profile.birthYear),
      heightCm: profile.heightCm,
      currentWeight,
      targetWeight: t,
      targetDate: draft.date || null,
      today: today(),
    });
  }, [draft, profile, currentWeight]);
}

export function goalDraftValid(draft: GoalDraft, ev: GoalEvaluation | null): boolean {
  // Nothing is forbidden: unsafe or unusual goals only show warnings.
  if (draft.mode === 'maintain') return fieldValid(draft.tolerance, 0.01, 100, true);
  if (!ev) return false;
  return fieldValid(draft.bodyFat, LIMITS.bodyFat.min, LIMITS.bodyFat.max);
}

export function GoalEditor({
  draft,
  onChange,
  profile,
  currentWeight,
}: {
  draft: GoalDraft;
  onChange: (d: GoalDraft) => void;
  profile: Pick<Profile, 'sex' | 'birthYear' | 'heightCm'> | null;
  currentWeight: number | null;
}) {
  const ev = useGoalEvaluation(draft, profile, currentWeight);
  const age = profile ? ageFromBirthYear(profile.birthYear) : 30;
  const isMinor = age < 18;
  const set = (patch: Partial<GoalDraft>) => onChange({ ...draft, ...patch });
  const t = parseDecimal(draft.target);
  const wrongDirection = t != null && currentWeight != null && draft.mode !== 'maintain' && goalDirection(currentWeight, t) !== draft.mode && goalDirection(currentWeight, t) !== 'maintain';
  const range = profile && !isMinor ? healthyWeightRange(profile.heightCm) : null;

  return (
    <div className="stack">
      <Segmented
        label="Тип цели"
        value={draft.mode}
        onChange={(mode) => set({ mode })}
        items={[
          { value: 'loss', label: 'Снизить вес' },
          { value: 'gain', label: 'Набрать' },
          { value: 'maintain', label: 'Поддерживать' },
        ]}
      />
      {draft.mode === 'maintain' ? (
        <>
          <NumberField
            label="Допустимое отклонение"
            value={draft.tolerance}
            onChange={(v) => set({ tolerance: v })}
            suffix="± кг"
            min={0.01}
            max={100}
            required
            hint={currentWeight != null ? `Диапазон вокруг ${fmtKg(currentWeight)}. Естественные колебания веса — 1–2 кг.` : undefined}
          />
          <Notice>В режиме поддержания FORMA показывает, остаёшься ли ты в выбранном диапазоне, и анализирует долгосрочный тренд.</Notice>
        </>
      ) : (
        <>
          <NumberField
            label="Целевой вес"
            value={draft.target}
            onChange={(v) => set({ target: v })}
            suffix="кг"
            min={LIMITS.weight.min} typical={TYPICAL.weight}
            max={LIMITS.weight.max}
            required
            testId="goal-target"
            hint={range ? `Здоровый диапазон для твоего роста (ИМТ 18,5–24,9): ${fmtNum(range.min, 2)}–${fmtNum(range.max, 2)} кг` : undefined}
          />
          {wrongDirection && <Notice tone="warn">Целевой вес {draft.mode === 'loss' ? 'больше' : 'меньше'} текущего. Проверь тип цели.</Notice>}
          <div className="field">
            <label htmlFor="goal-date">Желаемый срок (необязательно)</label>
            <input id="goal-date" className="input" type="date" min={today()} value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            <span className="field-hint">Без срока FORMA рассчитает дату по безопасному темпу.</span>
          </div>
          {!(isMinor && draft.mode === 'loss') && (
            <div className="field">
              <span className="field-label">Темп</span>
              <Segmented
                label="Темп"
                value={draft.pace}
                onChange={(pace) => set({ pace })}
                items={[
                  { value: 'calm', label: 'Спокойный' },
                  { value: 'moderate', label: 'Умеренный' },
                  { value: 'active', label: 'Активный' },
                ]}
              />
              <span className="field-hint">
                ≈ {fmtNum(paceValue(draft.mode, draft.pace, isMinor), 2)}% веса в неделю
                {currentWeight != null && ` · ${fmtNum((currentWeight * paceValue(draft.mode, draft.pace, isMinor)) / 100, 2)} кг/нед`}
              </span>
            </div>
          )}
          <NumberField label="Желаемый процент жира (необязательно)" value={draft.bodyFat} onChange={(v) => set({ bodyFat: v })} suffix="%" min={LIMITS.bodyFat.min} typical={TYPICAL.bodyFat} max={LIMITS.bodyFat.max} />
          {ev && (
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              {ev.issues.map((i, k) => (
                <Notice key={k} tone={i.level === 'danger' ? 'danger' : i.level === 'warn' ? 'warn' : 'info'}>{i.text}</Notice>
              ))}
              {ev.verdict !== 'blocked' && ev.earliestSafeDate && (
                <div className="goal-plan">
                  <div>
                    <span className="eyebrow">Безопасный срок</span>
                    <div className="strong">не раньше {formatDate(ev.earliestSafeDate, { year: true })}</div>
                  </div>
                  <div>
                    <span className="eyebrow">Комфортный темп</span>
                    <div className="strong">к {formatDate(ev.comfortableDate!, { year: true })}</div>
                  </div>
                </div>
              )}
              {ev.verdict === 'unsafe' && ev.earliestSafeDate && (
                <button type="button" className="btn sm" onClick={() => set({ date: ev.comfortableDate! })}>
                  Предложить срок: {formatDate(ev.comfortableDate!, { year: true })}
                </button>
              )}
              {ev.verdict === 'blocked' && ev.minTargetWeight != null && (
                <button type="button" className="btn sm" onClick={() => set({ target: fmtNum(ev.minTargetWeight!, 2) })}>
                  Установить {fmtKg(ev.minTargetWeight)}
                </button>
              )}
              {ev.verdict === 'ok' && <Notice tone="positive">Цель реалистична и безопасна.</Notice>}
              {(ev.verdict === 'unsafe' || ev.verdict === 'blocked') && <p className="small muted">Сохранить цель можно и так — это твоё решение.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
