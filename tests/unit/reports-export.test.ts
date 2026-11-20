import { describe, expect, it } from 'vitest';
import { buildReport, periodRange } from '@/lib/reports';
import { computeSummary } from '@/lib/summary';
import { csvCell, entriesCSV, toCSV } from '@/lib/export/files';
import type { Goal } from '@/domain/types';
import { data, entry, habit, series } from './helpers';

const goal: Goal = {
  id: 'g', startWeight: 90, startDate: '2026-01-01', targetWeight: 80, targetBodyFat: null, targetDate: null,
  targetMeasurements: {}, shape: 'leaner', shapeNote: '', pacePctPerWeek: 0.5, status: 'active', achievedAt: null, createdAt: 0,
};

describe('reports', () => {
  it('summarises a period without inventing values for missing days', () => {
    const d = data({ entries: [...series('2026-01-01', 30, 90, -0.1, 0, 3), entry('2026-01-15', null, { measurements: { waist: 90 } }), entry('2026-01-29', null, { measurements: { waist: 88 } })] });
    const r = buildReport(d, '2026-01-01', '2026-01-31');
    expect(r.weight.loggedDays).toBe(10); // every 3rd day only
    expect(r.weight.start).toBe(90);
    expect(r.weight.change).toBeCloseTo(-2.7, 5);
    expect(r.days).toBe(31);
    expect(r.measurements.find((m) => m.key === 'waist')!.change).toBe(-2);
  });
  it('habit completion within the period', () => {
    const h = habit({ schedules: [{ from: '2026-01-01', schedule: { type: 'daily' } }] });
    const logs = ['2026-01-01', '2026-01-02', '2026-01-04'].map((date) => ({ id: `h1|${date}`, habitId: 'h1', date, value: 1, updatedAt: 0 }));
    const r = buildReport(data({ habits: [h], habitLogs: logs }), '2026-01-01', '2026-01-04');
    expect(r.habits[0].done).toBe(3);
    expect(r.habits[0].scheduled).toBe(4);
    expect(r.habitRate).toBeCloseTo(0.75);
  });
  it('period ranges', () => {
    expect(periodRange('week', data(), '2026-01-10')).toEqual({ from: '2026-01-04', to: '2026-01-10' });
    expect(periodRange('goal', data({ goals: [goal] }), '2026-03-01').from).toBe('2026-01-01');
    expect(periodRange('custom', data(), '2026-03-01', { from: '2026-02-01', to: '2026-02-10' })).toEqual({ from: '2026-02-01', to: '2026-02-10' });
  });
});

describe('summary', () => {
  it('progress is based on the smoothed trend and status follows the forecast', () => {
    const s = computeSummary(data({ entries: series('2026-01-01', 28, 90, -0.08, 0.2), goals: [goal] }), '2026-01-28');
    expect(s.current).not.toBeNull();
    expect(s.progress!.fraction).toBeGreaterThan(0.1);
    expect(s.progress!.fraction).toBeLessThan(0.3);
    expect(['on_track', 'slow']).toContain(s.status);
  });
  it('reports collecting data instead of a fake forecast', () => {
    const s = computeSummary(data({ entries: series('2026-01-01', 3, 90, -0.1), goals: [goal] }), '2026-01-03');
    expect(s.status).toBe('collecting');
    expect(s.forecast.date).toBeNull();
    expect(s.change30).toBeNull();
  });
  it('maintenance band status', () => {
    const s = computeSummary(data({ entries: series('2026-01-01', 10, 72, 0), maintenance: { enabled: true, centerWeight: 70, toleranceKg: 1, startedAt: '2026-01-01' } }), '2026-01-10');
    expect(s.status).toBe('maintenance_out');
    expect(s.maintenance!.deviation).toBeCloseTo(1, 1);
  });
});

describe('CSV export', () => {
  it('neutralises formula injection and quotes fields', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2.5')).toBe('-2.5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(toCSV([['a', 'b']]).startsWith('﻿')).toBe(true);
  });
  it('writes one row per entry with measurement columns', () => {
    const csv = entriesCSV([entry('2026-01-01', 70.5, { measurements: { waist: 80 }, note: 'утро' })], []);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('70.5');
    expect(lines[1]).toContain('утро');
  });
});
