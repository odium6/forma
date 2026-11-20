import type { HHmm, Reminder, Settings } from '@/domain/types';
import { addDays, isoWeek, toISODate, weekday } from '@/lib/dates';

export function minutesOf(t: HHmm): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function inQuietHours(t: HHmm, q: Settings['quietHours']): boolean {
  if (!q.enabled) return false;
  const v = minutesOf(t);
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  return s <= e ? v >= s && v < e : v >= s || v < e;
}

export function occursOn(r: Reminder, date: string): boolean {
  if (!r.days.includes(weekday(date))) return false;
  if (r.parity === 'all') return true;
  const even = isoWeek(date) % 2 === 0;
  return r.parity === 'even' ? even : !even;
}

function at(date: string, t: HHmm): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Next firing time strictly after `from`. A reminder that falls inside quiet hours is
 * moved to the end of the quiet period on the same morning instead of being dropped.
 */
export function nextOccurrence(r: Reminder, from: Date, quiet: Settings['quietHours']): Date | null {
  if (!r.enabled || r.days.length === 0) return null;
  const start = toISODate(from);
  for (let i = 0; i < 21; i++) {
    const date = addDays(start, i);
    if (!occursOn(r, date)) continue;
    let when = at(date, r.time);
    if (inQuietHours(r.time, quiet)) {
      const endMin = minutesOf(quiet.end);
      const endDate = minutesOf(r.time) >= minutesOf(quiet.start) && minutesOf(quiet.start) > endMin ? addDays(date, 1) : date;
      when = at(endDate, quiet.end);
    }
    if (when.getTime() > from.getTime()) return when;
  }
  return null;
}

/** Most recent firing time in (now − lookbackMs, now]. */
export function lastOccurrence(r: Reminder, now: Date, quiet: Settings['quietHours'], lookbackMs: number): Date | null {
  let t = nextOccurrence(r, new Date(now.getTime() - lookbackMs), quiet);
  let last: Date | null = null;
  while (t && t.getTime() <= now.getTime()) {
    last = t;
    t = nextOccurrence(r, t, quiet);
  }
  return last;
}

export function describeReminder(r: Reminder): string {
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const days = r.days.length === 7 ? 'каждый день' : [...r.days].sort().map((d) => names[d]).join(', ');
  const parity = r.parity === 'all' ? '' : r.parity === 'even' ? ', чётные недели' : ', нечётные недели';
  return `${r.time} · ${days}${parity}`;
}

const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Calendar export of reminders. Calendar apps deliver alarms reliably even when the
 * browser cannot (e.g. iOS without push), so this is offered as a complement.
 */
export function remindersToICS(reminders: Reminder[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FORMA//Reminders//RU', 'CALSCALE:GREGORIAN'];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  for (const r of reminders.filter((x) => x.enabled && x.days.length)) {
    // first occurrence that matches the parity rule
    let first = toISODate(now);
    for (let i = 0; i < 14 && !occursOn(r, first); i++) first = addDays(first, 1);
    const [hh, mm] = r.time.split(':');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@forma.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${first.replace(/-/g, '')}T${hh}${mm}00`,
      'DURATION:PT5M',
      `RRULE:FREQ=WEEKLY;INTERVAL=${r.parity === 'all' ? 1 : 2};BYDAY=${[...r.days].sort().map((d) => ICS_DAYS[d]).join(',')}`,
      `SUMMARY:${icsEscape(`FORMA: ${r.label}`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(r.label)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
