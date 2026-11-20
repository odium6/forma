import type { BuiltinMeasurementKey, CustomMetric, MeasurementKey } from '@/domain/types';

export const MEASUREMENT_LABELS: Record<BuiltinMeasurementKey, string> = {
  waist: 'Талия',
  chest: 'Грудь',
  hips: 'Бёдра',
  neck: 'Шея',
  arm: 'Рука',
  forearm: 'Предплечье',
  thigh: 'Бедро',
  calf: 'Голень',
};

export const MEASUREMENT_HINTS: Record<BuiltinMeasurementKey, string> = {
  waist: 'На уровне пупка, на выдохе',
  chest: 'По самой выступающей линии',
  hips: 'По самой широкой части ягодиц',
  neck: 'Под кадыком',
  arm: 'Бицепс, в расслабленном состоянии',
  forearm: 'Самое широкое место',
  thigh: 'Под ягодичной складкой',
  calf: 'Самое широкое место',
};

export function metricLabel(key: MeasurementKey | string, custom: CustomMetric[]): { label: string; unit: string } {
  if (key.startsWith('custom:')) {
    const m = custom.find((c) => `custom:${c.id}` === key);
    return { label: m?.name ?? 'Параметр', unit: m?.unit ?? '' };
  }
  return { label: MEASUREMENT_LABELS[key as BuiltinMeasurementKey] ?? key, unit: 'см' };
}

export function allMetricKeys(custom: CustomMetric[]): MeasurementKey[] {
  return [...(Object.keys(MEASUREMENT_LABELS) as BuiltinMeasurementKey[]), ...custom.map((c) => `custom:${c.id}` as const)];
}
