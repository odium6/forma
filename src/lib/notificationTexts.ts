import type { Reminder } from '@/domain/types';

/**
 * Prepared notification texts. Shared by the app (local reminders) and by the
 * push Worker (server reminders), so both use the same wording rules. No generated text.
 */
export const NOTIFICATION_TEXTS = {
  weigh: ['Пора внести вес — это займёт 10 секунд.', 'Утреннее измерение — лучший ориентир для тренда.', 'Небольшой шаг: внеси сегодняшний вес.'],
  habits: ['Отметь привычки за сегодня.', 'Как прошёл день? Отметь выполненные привычки.'],
  photo: ['Время для фото прогресса: тот же ракурс и свет.', 'Новое фото поможет увидеть изменения, которые не видны на весах.'],
  custom: ['Напоминание FORMA'],
  motivation: ['Каждое измерение делает прогноз точнее.', 'Маленькие шаги складываются в форму.', 'Регулярность важнее идеальности.'],
} as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable pseudo-random choice: varies by seed (e.g. date) without flickering between calls. */
export function pick<T>(variants: readonly T[], seed: string): T {
  return variants[hash(seed) % variants.length];
}

export function reminderText(r: Pick<Reminder, 'kind' | 'label'>, seed: string, motivation: boolean): string {
  if (r.kind === 'custom') return r.label;
  const base = pick(NOTIFICATION_TEXTS[r.kind], seed);
  return motivation ? `${base} ${pick(NOTIFICATION_TEXTS.motivation, `${seed}m`)}` : base;
}

export function reminderUrl(kind: Reminder['kind']): string {
  return kind === 'weigh' ? './#/?entry=1' : kind === 'habits' ? './#/habits' : kind === 'photo' ? './#/photos' : './#/';
}
