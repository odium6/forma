import type { ISODate } from '@/domain/types';

/** Local calendar-date helpers. All arithmetic is done at UTC noon to avoid DST drift. */

const DAY = 86_400_000;

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Day number since epoch for a local ISO date (integer, DST-safe). */
export function dayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(date) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(a) - dayNumber(b);
}

/** 0 = Monday … 6 = Sunday */
export function weekday(date: ISODate): number {
  // 1970-01-01 was a Thursday (index 3).
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekday(date));
}

/** ISO-8601 week number. */
export function isoWeek(date: ISODate): number {
  const thursday = addDays(date, 3 - weekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(thursday, yearStart) / 7) + 1;
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function rangeDays(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = dayNumber(from), end = dayNumber(to); n <= end; n++) out.push(fromDayNumber(n));
  return out;
}

export function ageFromBirthYear(birthYear: number, on: ISODate = today()): number {
  return Number(on.slice(0, 4)) - birthYear;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export function formatDate(date: ISODate, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number);
  let s = `${d} ${MONTHS_GEN[m - 1]}`;
  if (opts.year ?? Number(y) !== new Date().getFullYear()) s += ` ${y}`;
  if (opts.weekday) s = `${WEEKDAYS_FULL[weekday(date)]}, ${s}`;
  return s;
}

export function formatDateShort(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export function formatMonthYear(date: ISODate): string {
  const [y, m] = date.split('-').map(Number);
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

export function formatMonthShort(date: ISODate): string {
  const [y, m] = date.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}
