import { describe, expect, it } from 'vitest';
import { evaluateAchievements, levelFor, totalPoints } from '@/lib/achievements';
import { buildInsights, visibleInsights } from '@/lib/insights';
import type { Goal } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';
import { data, entry, series } from './helpers';

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', startWeight: 90, startDate: '2026-01-01', targetWeight: 80, targetBodyFat: null, targetDate: null,
  targetMeasurements: {}, shape: 'leaner', shapeNote: '', pacePctPerWeek: 0.5, status: 'active', achievedAt: null, createdAt: 0, ...over,
});

describe('achievements', () => {
  it('awards nothing for an empty account', () => {
    expect(evaluateAchievements(data(), '2026-02-01')).toEqual([]);
  });
  it('dates achievements by the event, not by evaluation time', () => {
    const d = data({ entries: series('2026-01-01', 12, 90, -0.1) });
    const got = Object.fromEntries(evaluateAchievements(d, '2026-03-01').map((a) => [a.id, a.date]));
    expect(got.first_entry).toBe('2026-01-01');
    expect(got.first_week).toBe('2026-01-07');
    expect(got.log_run_7).toBe('2026-01-07');
    expect(got.log_run_10).toBe('2026-01-10');
    expect(got.log_run_30).toBeUndefined();
  });
  it('kg milestones use the smoothed trend toward the goal', () => {
    const d = data({ entries: series('2026-01-01', 40, 90, -0.1), goals: [goal()] });
    const ids = evaluateAchievements(d, '2026-03-01').map((a) => a.id);
    expect(ids).toContain('kg_1');
    expect(ids).not.toContain('kg_5');
    expect(ids).toContain('goal_25');
  });
  it('a single low reading does not award a kilogram', () => {
    const d = data({ entries: [...series('2026-01-01', 10, 90, 0), entry('2026-01-11', 88.5)], goals: [goal()] });
    expect(evaluateAchievements(d, '2026-01-11').map((a) => a.id)).not.toContain('kg_1');
  });
  it('levels', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(45).title).toBe('Ритм');
    expect(levelFor(45).next!.left).toBe(55);
    expect(totalPoints([{ id: 'first_entry' }, { id: 'unknown' }])).toBe(10);
  });
});

describe('insights', () => {
  it('asks for the first entry when empty', () => {
    expect(buildInsights(data(), '2026-01-01')[0].id).toBe('no_data');
  });
  it('reports weekly average change and is stable within a day', () => {
    const d = data({ entries: series('2026-01-01', 14, 90, -0.06), goals: [goal()] });
    const a = buildInsights(d, '2026-01-14');
    expect(a.find((i) => i.id === 'week_avg')!.text).toMatch(/снизился на 0,4\d кг/);
    expect(buildInsights(d, '2026-01-14').map((i) => i.text)).toEqual(a.map((i) => i.text));
  });
  it('explains a sudden jump as water, not fat', () => {
    const d = data({ entries: [...series('2026-01-01', 10, 80, 0), entry('2026-01-11', 81.5)] });
    expect(buildInsights(d, '2026-01-11').find((i) => i.id === 'jump')!.text).toMatch(/вод/);
  });
  it('hides motivational messages when disabled', () => {
    const d = data({ entries: series('2026-01-01', 14, 90, -0.06), settings: { ...DEFAULT_SETTINGS, motivation: false } });
    expect(visibleInsights(d, '2026-01-14', 10).every((i) => !i.motivational)).toBe(true);
  });
  it('never uses shaming words', () => {
    const d = data({ entries: series('2026-01-01', 28, 80, 0.08), goals: [goal({ startWeight: 80, targetWeight: 72 })] });
    const text = buildInsights(d, '2026-01-28').map((i) => i.text).join(' ');
    expect(text).not.toMatch(/плохо|провал|стыд|ленив/i);
    expect(text).toMatch(/не повод для самокритики|сфокусироваться/);
  });
});
