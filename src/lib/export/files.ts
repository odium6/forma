import type { CustomMetric, Entry, Habit, HabitLog } from '@/domain/types';
import { allMetricKeys, metricLabel } from '@/lib/metrics';
import { isIOS } from '@/lib/notify';

/** Neutralises spreadsheet formula injection and quotes fields (RFC 4180). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 Cyrillic correctly; ; is not used to stay RFC-compatible
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function entriesCSV(entries: Entry[], custom: CustomMetric[]): string {
  const keys = allMetricKeys(custom);
  const head = ['date', 'time', 'weight_kg', 'body_fat_pct', ...keys.map((k) => `${metricLabel(k, custom).label} (${metricLabel(k, custom).unit})`), 'note', 'source'];
  const rows = entries.map((e) => [e.date, e.time, e.weight ?? '', e.bodyFat ?? '', ...keys.map((k) => e.measurements[k] ?? ''), e.note, e.source]);
  return toCSV([head, ...rows]);
}

export function habitsCSV(habits: Habit[], logs: HabitLog[]): string {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const rows = [...logs].sort((a, b) => a.date.localeCompare(b.date)).map((l) => {
    const h = byId.get(l.habitId);
    return [l.date, h?.name ?? l.habitId, l.value, h?.kind ?? '', h?.target ?? '', h?.unit ?? ''];
  });
  return toCSV([['date', 'habit', 'value', 'kind', 'target', 'unit'], ...rows]);
}

/** Saves a file. On iOS (where downloads from standalone PWAs are unreliable) the share sheet is offered. */
export async function saveFile(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
