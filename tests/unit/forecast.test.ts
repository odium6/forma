import { describe, expect, it } from 'vitest';
import { forecastGoal, forecastPath } from '@/lib/math/forecast';
import { dailySeries } from '@/lib/math/series';
import { diffDays } from '@/lib/dates';
import { entry, series } from './helpers';

describe('forecastGoal', () => {
  it('needs enough data', () => {
    const f = forecastGoal(dailySeries(series('2026-01-01', 4, 90, -0.1), 'weight'), 80, '2026-01-04');
    expect(f.status).toBe('insufficient');
    expect(f.date).toBeNull();
    expect(f.needPoints).toBeGreaterThan(0);
  });
  it('predicts a date with an interval around it', () => {
    const pts = dailySeries(series('2026-01-01', 28, 90, -0.1, 0.2), 'weight');
    const f = forecastGoal(pts, 85, '2026-01-28');
    expect(f.status).toBe('ok');
    const d = diffDays(f.date!, '2026-01-28');
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(35);
    expect(f.early! <= f.date!).toBe(true);
    expect(!f.late || f.late >= f.date!).toBe(true);
  });
  it('is stable against one extreme reading', () => {
    const e = series('2026-01-01', 28, 90, -0.1, 0.2);
    const before = forecastGoal(dailySeries(e, 'weight'), 85, '2026-01-28').date!;
    const after = forecastGoal(dailySeries([...e, entry('2026-01-29', 84.2)], 'weight'), 85, '2026-01-29').date!;
    expect(Math.abs(diffDays(after, before))).toBeLessThan(5);
  });
  it('detects trend away from the goal and flat trends', () => {
    expect(forecastGoal(dailySeries(series('2026-01-01', 28, 80, 0.05), 'weight'), 75, '2026-01-28').status).toBe('away');
    expect(forecastGoal(dailySeries(series('2026-01-01', 28, 80, 0.001), 'weight'), 75, '2026-01-28').status).toBe('flat');
  });
  it('reports reached and too-far horizons', () => {
    expect(forecastGoal(dailySeries(series('2026-01-01', 28, 80.1, -0.005), 'weight'), 80, '2026-01-28').status).toBe('reached');
    expect(forecastGoal(dailySeries(series('2026-01-01', 28, 120, -0.01), 'weight'), 60, '2026-01-28').status).toBe('too_far');
  });
  it('path stops at the target', () => {
    const pts = dailySeries(series('2026-01-01', 28, 90, -0.1), 'weight');
    const f = forecastGoal(pts, 85, '2026-01-28');
    const path = forecastPath(f, 85);
    expect(path.length).toBeGreaterThan(2);
    expect(Math.min(...path.map((p) => p.value))).toBeGreaterThanOrEqual(85);
  });
});
