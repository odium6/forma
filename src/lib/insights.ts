import type { AppData, Goal, ISODate } from '@/domain/types';
import { dayNumber, diffDays, today as todayFn } from '@/lib/dates';
import { fmtNum, nDays } from '@/lib/format';
import { dailySeries, trendChange, weeklyAverageChange, type Point } from '@/lib/math/series';
import { forecastGoal } from '@/lib/math/forecast';
import { habitStats, indexLogs } from '@/lib/habits';
import { pick } from '@/lib/notificationTexts';

export { pick, NOTIFICATION_TEXTS } from '@/lib/notificationTexts';

/**
 * Rule-based insights built from a fixed library of phrasings. No generated text:
 * every message is a template filled with computed numbers. A stable per-day choice
 * keeps the wording varied over time without flickering between renders.
 */
export type Tone = 'positive' | 'neutral' | 'care' | 'info';

export interface Insight {
  id: string;
  tone: Tone;
  text: string;
  priority: number;
  /** Motivational (as opposed to factual) messages can be disabled in settings. */
  motivational: boolean;
}

const kg = (v: number) => `${fmtNum(Math.abs(v), 2)} кг`;
const cm = (v: number) => `${fmtNum(Math.abs(v), 2)} см`;

export function activeGoal(data: AppData): Goal | null {
  return [...data.goals].reverse().find((g) => g.status === 'active') ?? null;
}

function loggingStreak(data: AppData, asOf: ISODate): number {
  const days = new Set(data.entries.filter((e) => e.weight != null).map((e) => e.date));
  let n = 0;
  let d = dayNumber(asOf);
  if (!days.has(asOf)) d -= 1; // today not logged yet does not break the streak
  for (const set = new Set([...days].map(dayNumber)); set.has(d); d--) n++;
  return n;
}

function measurementChange(points: Point[], asOf: ISODate, days: number): number | null {
  const from = dayNumber(asOf) - days;
  const win = points.filter((p) => p.day >= from - 3 && p.day <= dayNumber(asOf));
  if (win.length < 2) return null;
  if (win[win.length - 1].day - win[0].day < Math.min(14, days / 2)) return null;
  return win[win.length - 1].value - win[0].value;
}

export function buildInsights(data: AppData, asOf: ISODate = todayFn()): Insight[] {
  const out: Insight[] = [];
  const seed = (id: string) => `${id}|${asOf}`;
  const add = (id: string, tone: Tone, priority: number, variants: string[], motivational = false) =>
    out.push({ id, tone, priority, text: pick(variants, seed(id)), motivational });

  const pts = dailySeries(data.entries, 'weight');
  const goal = activeGoal(data);
  const dir = goal?.targetWeight != null ? Math.sign(goal.targetWeight - goal.startWeight) : 0;
  const maintenance = data.maintenance?.enabled ? data.maintenance : null;

  if (!pts.length) {
    add('no_data', 'info', 100, ['Внеси первый вес — с него начнётся твой график и прогноз.', 'Первое измерение станет стартовой точкой. Достаточно только веса.']);
    return out;
  }

  const last = pts[pts.length - 1];
  const sinceLast = diffDays(asOf, last.date);
  if (sinceLast >= 5) {
    add('gap', 'care', 90, [
      `Последнее измерение было ${nDays(sinceLast)} назад. Ничего страшного — просто продолжи с сегодняшнего дня.`,
      `Перерыв ${nDays(sinceLast)} — это нормально. Новое измерение вернёт графику точность.`,
    ]);
  }

  const week = weeklyAverageChange(pts, asOf);
  if (week && Math.abs(week.delta) >= 0.1) {
    const down = week.delta < 0;
    const good = dir === 0 ? null : (dir < 0) === down;
    const verb = down ? 'снизился' : 'вырос';
    if (good === false) {
      add('week_avg', 'neutral', 70, [
        `Средний вес за неделю ${verb} на ${kg(week.delta)}. Недельные колебания часто связаны с водой, солью и временем измерения — важнее тренд за 2–4 недели.`,
        `Среднее за 7 дней ${verb} на ${kg(week.delta)}. Это не обязательно изменение жировой массы: вес естественно колеблется.`,
      ]);
    } else {
      add('week_avg', good ? 'positive' : 'neutral', 70, [`Средний вес за неделю ${verb} на ${kg(week.delta)}.`, `Среднее за последние 7 дней ${verb} на ${kg(week.delta)} по сравнению с предыдущей неделей.`]);
    }
  } else if (week) {
    add('week_avg', 'neutral', 40, ['Средний вес за неделю практически не изменился.', 'Неделя прошла стабильно: среднее значение почти то же.']);
  }

  const month = trendChange(pts, asOf, 30);
  if (month != null && Math.abs(month) >= 0.3) {
    add('month', dir !== 0 && Math.sign(month) === dir ? 'positive' : 'neutral', 60, [
      `За месяц сглаженный вес изменился на ${month < 0 ? '−' : '+'}${kg(month)}.`,
      `Тренд за 30 дней: ${month < 0 ? '−' : '+'}${kg(month)}.`,
    ]);
  }

  if (goal?.targetWeight != null && !maintenance) {
    const f = forecastGoal(pts, goal.targetWeight, asOf);
    if (f.status === 'insufficient') {
      add('forecast_data', 'info', 50, [
        'Для более точного прогноза продолжай регулярно вносить измерения.',
        `Ещё немного данных — и появится прогноз. Нужно ${f.needPoints > 0 ? `ещё ${f.needPoints} измер.` : ''}${f.needPoints > 0 && f.needSpanDays > 0 ? ' и ' : ''}${f.needSpanDays > 0 ? `наблюдения ещё ${nDays(f.needSpanDays)}` : ''}.`,
      ]);
    } else if (f.status === 'ok' && f.pctPerWeek != null) {
      if (f.pctPerWeek > (dir < 0 ? 1.0 : 0.5) + 0.1) {
        add('pace_fast', 'care', 85, [
          `Темп сейчас около ${fmtNum(f.pctPerWeek, 2)}% веса в неделю — быстрее безопасного диапазона. Слишком быстрое снижение часто означает потерю воды и мышц; бережный темп надёжнее.`,
        ]);
      } else {
        const planned = goal.pacePctPerWeek;
        const ratio = f.pctPerWeek / planned;
        add('pace', 'positive', 65, ratio >= 0.7 ? [
          'Текущий тренд соответствует выбранной цели.',
          'Темп совпадает с планом — так держать.',
          'Динамика идёт в соответствии с выбранным темпом.',
        ] : [
          'Тренд движется к цели, пусть и медленнее плана. Устойчивость важнее скорости.',
          'Движение к цели есть — немного спокойнее запланированного темпа.',
        ], true);
      }
    } else if (f.status === 'away') {
      add('away', 'care', 75, [
        'Последние недели тренд идёт от цели. Это повод мягко пересмотреть привычки или срок — не повод для самокритики.',
        'Тренд сейчас направлен в другую сторону. Попробуй сфокусироваться на 1–2 привычках, которые легче всего соблюдать.',
      ]);
    } else if (f.status === 'flat') {
      add('flat', 'neutral', 55, ['Последние измерения показывают стабильный тренд.', 'Вес держится стабильно уже несколько недель.']);
    }
    if (f.level != null) {
      const left = (goal.targetWeight - f.level) * dir;
      if (left > 0.3) add('left', 'info', 45, [`До цели осталось ${kg(left)}.`, `Осталось ${kg(left)} до целевого веса.`]);
    }
  }

  const waist = measurementChange(dailySeries(data.entries, 'waist'), asOf, 30);
  if (waist != null && Math.abs(waist) >= 0.5) {
    add('waist', waist < 0 ? 'positive' : 'neutral', 58, [
      `За последние 30 дней талия ${waist < 0 ? 'уменьшилась' : 'увеличилась'} на ${cm(waist)}.`,
      `Обхват талии за месяц: ${waist < 0 ? '−' : '+'}${cm(waist)}.`,
    ]);
  }

  if (pts.length >= 2) {
    const prev = pts[pts.length - 2];
    const jump = last.value - prev.value;
    if (last.day - prev.day <= 2 && Math.abs(jump) >= 1.0 && sinceLast <= 1) {
      add('jump', 'info', 80, [
        `Изменение на ${jump > 0 ? '+' : '−'}${kg(jump)} за ${last.day - prev.day === 1 ? 'день' : 'пару дней'} почти всегда связано с водой, солью или временем измерения. Тренд сглаживает такие скачки.`,
        `Резкий скачок (${jump > 0 ? '+' : '−'}${kg(jump)}) — естественное колебание, а не изменение жира. Прогноз на него почти не реагирует.`,
      ]);
    }
  }

  const streak = loggingStreak(data, asOf);
  if (streak >= 3) {
    add('logging', 'positive', streak % 7 === 0 ? 68 : 35, [
      `Ты уже ${nDays(streak)} подряд вносишь вес.`,
      `${nDays(streak)} регулярных измерений подряд — отличная основа для точного тренда.`,
      `Серия измерений: ${nDays(streak)}.`,
    ], true);
  }

  const idx = indexLogs(data.habitLogs);
  for (const h of data.habits.filter((x) => !x.archivedAt)) {
    const s = habitStats(h, idx, asOf);
    if (s.current >= 3 && s.current >= s.best && s.todayDone) {
      add(`record_${h.id}`, 'positive', 62, [`Новый рекорд серии «${h.name}»: ${s.current}!`, `«${h.name}» — личный рекорд, ${s.current} подряд.`], true);
      break;
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
}

export function visibleInsights(data: AppData, asOf?: ISODate, limit = 4): Insight[] {
  const all = buildInsights(data, asOf);
  return (data.settings.motivation ? all : all.filter((i) => !i.motivational)).slice(0, limit);
}
