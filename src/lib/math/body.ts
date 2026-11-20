import type { ActivityLevel, Sex } from '@/domain/types';

export const ADULT_AGE = 18;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, { title: string; hint: string }> = {
  sedentary: { title: 'Минимальная', hint: 'Сидячая работа, почти без тренировок' },
  light: { title: 'Лёгкая', hint: 'Прогулки, 1–2 тренировки в неделю' },
  moderate: { title: 'Средняя', hint: '3–4 тренировки в неделю' },
  active: { title: 'Высокая', hint: '5–6 тренировок или активная работа' },
  very_active: { title: 'Очень высокая', hint: 'Ежедневные интенсивные нагрузки' },
};

export function bmi(weightKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

/** WHO adult categories. Returns null for minors: adult cut-offs do not apply to them. */
export function bmiCategory(value: number, age: number): BmiCategory | null {
  if (age < ADULT_AGE) return null;
  if (value < 18.5) return 'underweight';
  if (value < 25) return 'normal';
  if (value < 30) return 'overweight';
  return 'obese';
}

export const BMI_LABELS: Record<BmiCategory, string> = {
  underweight: 'ниже нормы',
  normal: 'в пределах нормы',
  overweight: 'выше нормы',
  obese: 'значительно выше нормы',
};

/** Weight range for adult BMI 18.5–24.9. */
export function healthyWeightRange(heightCm: number): { min: number; max: number } {
  const h = heightCm / 100;
  return { min: 18.5 * h * h, max: 24.9 * h * h };
}

/** Mifflin–St Jeor resting energy expenditure, kcal/day. */
export function bmrMifflin(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function tdee(sex: Sex, weightKg: number, heightCm: number, age: number, activity: ActivityLevel): number {
  return bmrMifflin(sex, weightKg, heightCm, age) * ACTIVITY_FACTORS[activity];
}

/**
 * U.S. Navy circumference method (Hodgdon & Beckett), metric form.
 * Returns null if inputs are missing or produce an invalid logarithm.
 */
export function navyBodyFat(
  sex: Sex,
  heightCm: number,
  waistCm: number | undefined,
  neckCm: number | undefined,
  hipsCm?: number,
): number | null {
  if (!waistCm || !neckCm || heightCm <= 0) return null;
  let bf: number;
  if (sex === 'male') {
    if (waistCm - neckCm <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else {
    if (!hipsCm || waistCm + hipsCm - neckCm <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipsCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  }
  if (!Number.isFinite(bf) || bf < 2 || bf > 70) return null;
  return bf;
}

/** Plausible input bounds used by all forms and by backup validation. */
export const LIMITS = {
  weight: { min: 20, max: 400 },
  height: { min: 100, max: 250 },
  bodyFat: { min: 2, max: 75 },
  measurement: { min: 5, max: 300 },
  birthYear: { min: 1900, max: new Date().getFullYear() - 8 },
} as const;
