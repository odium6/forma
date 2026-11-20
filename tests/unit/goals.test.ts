import { describe, expect, it } from 'vitest';
import { evaluateGoal, calorieGuidance } from '@/lib/math/goals';
import { goalProgress, maintenanceStatus } from '@/lib/math/progress';
import { bmi, bmiCategory, navyBodyFat, bmrMifflin } from '@/lib/math/body';

const base = { sex: 'male' as const, age: 30, heightCm: 180, today: '2026-01-01' };

describe('goalProgress', () => {
  it('works for loss and gain', () => {
    expect(goalProgress(100, 80, 90)!.fraction).toBeCloseTo(0.5);
    expect(goalProgress(60, 70, 65)!.fraction).toBeCloseTo(0.5);
    expect(goalProgress(60, 70, 65)!.leftKg).toBeCloseTo(5);
  });
  it('never goes below 0 or above 1 and reports state', () => {
    const r = goalProgress(100, 80, 103)!;
    expect(r.fraction).toBe(0);
    expect(r.state).toBe('regressed');
    const o = goalProgress(100, 80, 78)!;
    expect(o.fraction).toBe(1);
    expect(o.state).toBe('reached');
    expect(o.raw).toBeGreaterThan(1);
  });
  it('returns null when start equals target', () => {
    expect(goalProgress(80, 80, 80)).toBeNull();
  });
  it('recalculates against a new goal without touching history', () => {
    // same current weight, different goal → different fraction, same inputs
    expect(goalProgress(100, 90, 95)!.fraction).toBeCloseTo(0.5);
    expect(goalProgress(95, 85, 95)!.fraction).toBe(0);
  });
});

describe('evaluateGoal', () => {
  it('flags absurd deadlines (10 kg in 2 days) as unsafe', () => {
    const r = evaluateGoal({ ...base, currentWeight: 90, targetWeight: 80, targetDate: '2026-01-03' });
    expect(r.verdict).toBe('unsafe');
    expect(r.requiredPctPerWeek).toBeGreaterThan(30);
    expect(r.earliestSafeDate! > '2026-03-01').toBe(true);
  });
  it('blocks targets below healthy BMI for adults', () => {
    const r = evaluateGoal({ ...base, currentWeight: 70, targetWeight: 55, targetDate: null });
    expect(r.verdict).toBe('blocked');
    expect(r.minTargetWeight).toBeCloseTo(60, 0);
  });
  it('accepts a moderate goal', () => {
    const r = evaluateGoal({ ...base, currentWeight: 90, targetWeight: 82, targetDate: '2026-06-01' });
    expect(r.verdict).toBe('ok');
    expect(r.suggestedPctPerWeek).toBeGreaterThan(0);
  });
  it('does not personalise loss plans for minors', () => {
    const r = evaluateGoal({ ...base, age: 16, currentWeight: 70, targetWeight: 65, targetDate: null });
    expect(r.isMinor).toBe(true);
    expect(r.suggestedPctPerWeek).toBeNull();
    expect(r.minTargetWeight).toBeNull();
    expect(evaluateGoal({ ...base, age: 12, currentWeight: 50, targetWeight: 45, targetDate: null }).verdict).toBe('blocked');
  });
  it('applies stricter gain limits', () => {
    const r = evaluateGoal({ ...base, currentWeight: 70, targetWeight: 76, targetDate: '2026-02-01' });
    expect(r.verdict).toBe('unsafe');
  });
  it('rejects past deadlines', () => {
    expect(evaluateGoal({ ...base, currentWeight: 90, targetWeight: 85, targetDate: '2025-12-01' }).verdict).toBe('unsafe');
  });
});

describe('body formulas', () => {
  it('BMI and categories (adult only)', () => {
    expect(bmi(81, 180)).toBeCloseTo(25, 1);
    expect(bmiCategory(26, 30)).toBe('overweight');
    expect(bmiCategory(26, 15)).toBeNull();
  });
  it('Mifflin–St Jeor', () => {
    expect(bmrMifflin('male', 80, 180, 30)).toBeCloseTo(1780, 0);
    expect(bmrMifflin('female', 60, 165, 30)).toBeCloseTo(1320.25, 1);
  });
  it('US Navy body fat in a plausible range', () => {
    const m = navyBodyFat('male', 180, 90, 38)!;
    expect(m).toBeGreaterThan(15);
    expect(m).toBeLessThan(25);
    expect(navyBodyFat('female', 165, 75, 33)).toBeNull();
    expect(navyBodyFat('female', 165, 75, 33, 100)).toBeGreaterThan(20);
  });
  it('calorie guidance never goes under the floor', () => {
    expect(calorieGuidance(1500, 'female', 'loss', 1, 90)).toEqual({ kcal: 1200, floored: true });
  });
  it('maintenance band', () => {
    expect(maintenanceStatus(70, 1, 72).state).toBe('above');
    expect(maintenanceStatus(70, 1, 72).deviation).toBeCloseTo(1);
    expect(maintenanceStatus(70, 1, 70.5).state).toBe('inside');
  });
});
