import type { BodyShapeGoal, MeasurementKey } from '@/domain/types';
import { createGoal, getState, setMaintenance, updateGoal } from '@/state/store';
import { ageFromBirthYear, diffDays, today } from '@/lib/dates';
import { parseDecimal } from '@/lib/format';
import { paceValue, type GoalDraft } from './GoalEditor';

/**
 * Persists a goal draft. A weight goal becomes the single active goal (older ones are
 * archived, history untouched); "maintain" switches on maintenance mode instead.
 */
export async function saveGoalDraft(
  draft: GoalDraft,
  currentWeight: number,
  extra: { shape: BodyShapeGoal; shapeNote: string; targetMeasurements: Partial<Record<MeasurementKey, number>> },
) {
  const s = getState();
  const isMinor = s.profile ? ageFromBirthYear(s.profile.birthYear) < 18 : false;
  if (draft.mode === 'maintain') {
    const active = s.goals.find((g) => g.status === 'active');
    if (active) await updateGoal({ ...active, status: 'archived' });
    await setMaintenance({ enabled: true, centerWeight: currentWeight, toleranceKg: parseDecimal(draft.tolerance) ?? 1.5, startedAt: today() });
    return;
  }
  if (s.maintenance?.enabled) await setMaintenance({ ...s.maintenance, enabled: false });
  const target = parseDecimal(draft.target);
  // with a deadline the plan pace is whatever the deadline requires (the user chose it)
  let pace = paceValue(draft.mode, draft.pace, isMinor);
  if (draft.date && target != null) {
    const weeks = diffDays(draft.date, today()) / 7;
    if (weeks > 0) pace = ((Math.abs(target - currentWeight) / currentWeight) * 100) / weeks;
  }
  await createGoal({
    startWeight: currentWeight,
    startDate: today(),
    targetWeight: target,
    targetBodyFat: parseDecimal(draft.bodyFat),
    targetDate: draft.date || null,
    targetMeasurements: extra.targetMeasurements,
    shape: extra.shape,
    shapeNote: extra.shapeNote.trim().slice(0, 300),
    pacePctPerWeek: pace,
  });
}
