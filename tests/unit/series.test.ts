import { describe, expect, it } from 'vitest';
import { dailySeries, exponentialTrend, linearTrend, movingAverage, trendChange, weeklyAverageChange } from '@/lib/math/series';
import { entry, series } from './helpers';

describe('dailySeries', () => {
  it('averages several weigh-ins on one day and keeps gaps', () => {
    const pts = dailySeries([entry('2026-01-01', 80), entry('2026-01-01', 81), entry('2026-01-04', 79)], 'weight');
    expect(pts).toHaveLength(2);
    expect(pts[0].value).toBe(80.5);
    expect(pts[1].date).toBe('2026-01-04');
  });
  it('ignores entries without the requested value', () => {
    expect(dailySeries([entry('2026-01-01', null), entry('2026-01-02', 70)], 'weight')).toHaveLength(1);
    expect(dailySeries([entry('2026-01-01', 70, { measurements: { waist: 90 } })], 'waist')[0].value).toBe(90);
  });
});

describe('movingAverage', () => {
  it('uses a calendar window and requires min points', () => {
    const pts = dailySeries(series('2026-01-01', 10, 80, 0), 'weight');
    const ma = movingAverage(pts, 7, 3);
    expect(ma[0]).toBeNull();
    expect(ma[1]).toBeNull();
    expect(ma[2]).toBe(80);
  });
  it('does not include points older than the window', () => {
    const pts = dailySeries([entry('2026-01-01', 100), entry('2026-01-10', 80), entry('2026-01-11', 80), entry('2026-01-12', 80)], 'weight');
    expect(movingAverage(pts, 7, 3)[3]).toBe(80);
  });
});

describe('exponentialTrend', () => {
  it('dampens a single spike', () => {
    const e = series('2026-01-01', 20, 80, 0);
    e[19] = entry('2026-01-20', 82);
    const t = exponentialTrend(dailySeries(e, 'weight'));
    expect(t[19]).toBeLessThan(80.3);
  });
  it('accounts for gaps (bigger step after a long pause)', () => {
    const a = exponentialTrend(dailySeries([entry('2026-01-01', 80), entry('2026-01-02', 78)], 'weight'));
    const b = exponentialTrend(dailySeries([entry('2026-01-01', 80), entry('2026-01-11', 78)], 'weight'));
    expect(80 - b[1]).toBeGreaterThan(80 - a[1]);
  });
});

describe('linearTrend', () => {
  it('recovers a known slope', () => {
    const pts = dailySeries(series('2026-01-01', 28, 90, -0.1, 0.3), 'weight');
    const f = linearTrend(pts, '2026-01-28', 28)!;
    expect(f.slope).toBeCloseTo(-0.1, 1);
    expect(f.n).toBe(28);
  });
  it('is robust to an outlier', () => {
    const e = series('2026-01-01', 21, 90, -0.1);
    e[10] = entry(e[10].date, 96);
    const f = linearTrend(dailySeries(e, 'weight'), '2026-01-21', 28)!;
    expect(f.outliersRemoved).toBe(1);
    expect(f.slope).toBeCloseTo(-0.1, 2);
  });
  it('returns null with too few or clustered points', () => {
    expect(linearTrend(dailySeries(series('2026-01-01', 3, 90, -0.1), 'weight'), '2026-01-03', 28)).toBeNull();
    expect(linearTrend(dailySeries(series('2026-01-01', 5, 90, -0.1), 'weight'), '2026-01-05', 28, { minPoints: 4, minSpanDays: 10 })).toBeNull();
  });
});

describe('period changes', () => {
  it('weekly average change needs ≥3 values per week', () => {
    const pts = dailySeries(series('2026-01-01', 14, 80, -0.1), 'weight');
    const w = weeklyAverageChange(pts, '2026-01-14')!;
    expect(w.delta).toBeCloseTo(-0.7, 5);
    expect(weeklyAverageChange(dailySeries(series('2026-01-01', 14, 80, -0.1, 0, 5), 'weight'), '2026-01-14')).toBeNull();
  });
  it('trendChange is null without data at the start of the period', () => {
    const pts = dailySeries(series('2026-01-20', 10, 80, -0.1), 'weight');
    expect(trendChange(pts, '2026-01-29', 30)).toBeNull();
    expect(trendChange(pts, '2026-01-29', 7)).toBeLessThan(0);
  });
});
