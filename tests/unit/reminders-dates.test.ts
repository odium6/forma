import { describe, expect, it } from 'vitest';
import { inQuietHours, nextOccurrence, occursOn, remindersToICS } from '@/lib/reminders';
import { addMonths, isoWeek, isISODate, weekday } from '@/lib/dates';
import { parseDecimal, plural } from '@/lib/format';
import type { Reminder } from '@/domain/types';

const rem = (over: Partial<Reminder> = {}): Reminder => ({ id: 'r1', enabled: true, label: 'Вес', kind: 'weigh', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], parity: 'all', createdAt: 0, ...over });
const quiet = { enabled: true, start: '22:30', end: '07:00' };

describe('dates', () => {
  it('weekday/isoWeek', () => {
    expect(weekday('2026-01-05')).toBe(0); // Monday
    expect(weekday('2026-01-11')).toBe(6);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2026-12-31')).toBe(53);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('format helpers', () => {
    expect(parseDecimal('72,4')).toBe(72.4);
    expect(parseDecimal('abc')).toBeNull();
    expect(plural(21, ['день', 'дня', 'дней'])).toBe('день');
    expect(plural(12, ['день', 'дня', 'дней'])).toBe('дней');
  });
});

describe('reminders', () => {
  it('quiet hours across midnight', () => {
    expect(inQuietHours('23:00', quiet)).toBe(true);
    expect(inQuietHours('06:59', quiet)).toBe(true);
    expect(inQuietHours('07:00', quiet)).toBe(false);
  });
  it('next occurrence today or tomorrow', () => {
    const n = nextOccurrence(rem(), new Date(2026, 0, 5, 7, 0), quiet)!;
    expect(n.getDate()).toBe(5);
    expect(n.getHours()).toBe(8);
    const m = nextOccurrence(rem(), new Date(2026, 0, 5, 9, 0), quiet)!;
    expect(m.getDate()).toBe(6);
  });
  it('defers reminders inside quiet hours to the end of them', () => {
    const n = nextOccurrence(rem({ time: '23:00' }), new Date(2026, 0, 5, 12, 0), quiet)!;
    expect([n.getDate(), n.getHours()]).toEqual([6, 7]);
  });
  it('even/odd week alternation', () => {
    expect(occursOn(rem({ parity: 'even' }), '2026-01-05')).toBe(isoWeek('2026-01-05') % 2 === 0);
    const n = nextOccurrence(rem({ parity: 'odd', days: [0] }), new Date(2026, 0, 6, 9, 0), quiet)!; // after Mon of week 2
    expect(isoWeek(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`) % 2).toBe(1);
  });
  it('disabled or dayless reminders never fire', () => {
    expect(nextOccurrence(rem({ enabled: false }), new Date(), quiet)).toBeNull();
    expect(nextOccurrence(rem({ days: [] }), new Date(), quiet)).toBeNull();
  });
  it('exports a valid calendar', () => {
    const ics = remindersToICS([rem({ parity: 'even', days: [0, 3] })], new Date(2026, 0, 5));
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
  });
});
