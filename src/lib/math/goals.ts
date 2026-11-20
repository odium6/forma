import type { ISODate, Sex } from '@/domain/types';
import { addDays, diffDays } from '@/lib/dates';
import { ADULT_AGE, bmi, healthyWeightRange } from './body';

/**
 * Goal safety rules. Paces are expressed as % of current body weight per week,
 * the common clinical framing (≈0.5–1 %/week for adult weight loss).
 */
export const PACE = {
  loss: { comfortable: 0.5, max: 1.0, ambitious: 0.75 },
  gain: { comfortable: 0.25, max: 0.5, ambitious: 0.35 },
  /** Stricter cap for teenagers; no personalised plan is generated for them. */
  minorLossMax: 0.5,
} as const;

export type GoalDirection = 'loss' | 'gain' | 'maintain';

export function goalDirection(current: number, target: number, epsilon = 0.3): GoalDirection {
  if (Math.abs(target - current) < epsilon) return 'maintain';
  return target < current ? 'loss' : 'gain';
}

export type Verdict = 'ok' | 'ambitious' | 'unsafe' | 'blocked';

export interface GoalIssue {
  level: 'info' | 'warn' | 'danger';
  text: string;
}

export interface GoalEvaluation {
  verdict: Verdict;
  direction: GoalDirection;
  deltaKg: number;
  /** Pace the chosen deadline would require, %/week (null when no deadline). */
  requiredPctPerWeek: number | null;
  /** Suggested pace for planning, %/week; null when we deliberately do not personalise (minors). */
  suggestedPctPerWeek: number | null;
  /** Earliest date at the maximum safe pace and date at a comfortable pace. */
  earliestSafeDate: ISODate | null;
  comfortableDate: ISODate | null;
  /** For loss goals: lowest target weight we support for this height (adults). */
  minTargetWeight: number | null;
  issues: GoalIssue[];
  isMinor: boolean;
}

export function weeksAtPace(current: number, deltaKg: number, pctPerWeek: number): number {
  const kgPerWeek = (current * pctPerWeek) / 100;
  return kgPerWeek > 0 ? Math.abs(deltaKg) / kgPerWeek : Infinity;
}

export function evaluateGoal(input: {
  sex: Sex;
  age: number;
  heightCm: number;
  currentWeight: number;
  targetWeight: number;
  targetDate: ISODate | null;
  today: ISODate;
}): GoalEvaluation {
  const { age, heightCm, currentWeight, targetWeight, targetDate, today } = input;
  const isMinor = age < ADULT_AGE;
  const direction = goalDirection(currentWeight, targetWeight);
  const deltaKg = targetWeight - currentWeight;
  const issues: GoalIssue[] = [];
  let verdict = 'ok' as Verdict;
  const raise = (v: Verdict) => {
    const order: Verdict[] = ['ok', 'ambitious', 'unsafe', 'blocked'];
    if (order.indexOf(v) > order.indexOf(verdict)) verdict = v;
  };

  let minTargetWeight: number | null = null;
  if (!isMinor) {
    const range = healthyWeightRange(heightCm);
    minTargetWeight = Math.ceil(range.min * 100) / 100;
    const targetBmi = bmi(targetWeight, heightCm);
    if (direction === 'loss' && targetBmi < 18.5) {
      raise('blocked');
      issues.push({
        level: 'danger',
        text: `Целевой вес ниже нижней границы здорового диапазона для твоего роста (ИМТ ${targetBmi.toFixed(2).replace('.', ',')}). Рекомендуем цель не ниже ${minTargetWeight.toLocaleString('ru-RU')} кг.`,
      });
    } else if (direction === 'gain' && targetBmi >= 30) {
      raise('ambitious');
      issues.push({ level: 'warn', text: 'Цель набора приводит к ИМТ выше 30. Если это осознанная спортивная цель, обсуди её со специалистом.' });
    }
  } else {
    issues.push({
      level: 'info',
      text: 'Для людей младше 18 лет взрослые нормы ИМТ и темпа похудения не применяются. FORMA помогает отслеживать данные и привычки, но не даёт персональных рекомендаций по снижению веса — их стоит обсудить с педиатром.',
    });
    if (direction === 'loss' && age < 14) {
      raise('blocked');
      issues.push({ level: 'danger', text: 'Снижение веса в этом возрасте стоит обсудить с врачом.' });
    }
  }

  const maxPace = direction === 'gain' ? PACE.gain.max : isMinor ? PACE.minorLossMax : PACE.loss.max;
  const comfortablePace = direction === 'gain' ? PACE.gain.comfortable : PACE.loss.comfortable;
  const ambitiousPace = direction === 'gain' ? PACE.gain.ambitious : isMinor ? PACE.minorLossMax * 0.8 : PACE.loss.ambitious;

  let earliestSafeDate: ISODate | null = null;
  let comfortableDate: ISODate | null = null;
  if (direction !== 'maintain' && verdict !== 'blocked') {
    earliestSafeDate = addDays(today, Math.ceil(weeksAtPace(currentWeight, deltaKg, maxPace) * 7));
    comfortableDate = addDays(today, Math.ceil(weeksAtPace(currentWeight, deltaKg, comfortablePace) * 7));
  }

  let requiredPctPerWeek: number | null = null;
  if (targetDate && direction !== 'maintain') {
    const days = diffDays(targetDate, today);
    if (days <= 0) {
      raise('unsafe');
      issues.push({ level: 'danger', text: 'Выбранная дата уже наступила.' });
    } else {
      requiredPctPerWeek = ((Math.abs(deltaKg) / currentWeight) * 100) / (days / 7);
      if (requiredPctPerWeek > maxPace + 1e-9) {
        raise('unsafe');
        issues.push({
          level: 'danger',
          text: `Такой срок требует темпа ${requiredPctPerWeek.toFixed(2).replace('.', ',')}% веса в неделю — это выше безопасного предела (${String(maxPace).replace('.', ',')}%). Быстрое изменение веса чаще связано с потерей воды и мышц и с откатом.${earliestSafeDate ? ' Можно сдвинуть срок.' : ''}`,
        });
      } else if (requiredPctPerWeek > ambitiousPace) {
        raise('ambitious');
        issues.push({ level: 'warn', text: 'Срок достижим, но темп близок к верхней безопасной границе. Более спокойный темп легче удержать.' });
      }
    }
  }

  const suggestedPctPerWeek =
    direction === 'maintain' || verdict === 'blocked' || (isMinor && direction === 'loss')
      ? null
      : requiredPctPerWeek != null && requiredPctPerWeek <= maxPace
        ? Math.max(requiredPctPerWeek, direction === 'gain' ? 0.1 : 0.2)
        : comfortablePace;

  return {
    verdict,
    direction,
    deltaKg,
    requiredPctPerWeek,
    suggestedPctPerWeek,
    earliestSafeDate,
    comfortableDate,
    minTargetWeight,
    issues,
    isMinor,
  };
}

/** Rough planning-only daily energy guidance for adults; floors prevent unsafe advice. */
export function calorieGuidance(tdeeKcal: number, sex: Sex, direction: GoalDirection, pctPerWeek: number, weight: number): { kcal: number; floored: boolean } {
  // ≈7700 kcal per kg of body-mass change
  const dailyDelta = ((weight * pctPerWeek) / 100) * 7700 / 7;
  const floor = sex === 'male' ? 1500 : 1200;
  if (direction === 'maintain') return { kcal: tdeeKcal, floored: false };
  if (direction === 'gain') return { kcal: tdeeKcal + Math.min(dailyDelta, 500), floored: false };
  const raw = tdeeKcal - dailyDelta;
  return raw < floor ? { kcal: floor, floored: true } : { kcal: raw, floored: false };
}
