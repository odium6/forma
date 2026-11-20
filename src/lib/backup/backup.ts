import { DATA_STORES, getDB } from '@/db/db';
import type { Settings } from '@/domain/types';
import { backupSchema, type BackupData, type BackupFile } from './schema';

export const MAX_BACKUP_BYTES = 600 * 1024 * 1024;

/** Deterministic JSON (sorted keys) so the checksum does not depend on key order. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`)
    .join(',')}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Settings that are tied to this device or are secrets are not exported. */
function portableSettings(s: Settings): BackupData['settings'] {
  const { pin: _pin, biometricCredentialId: _bio, persistentStorage: _ps, ...rest } = s;
  void _pin;
  void _bio;
  void _ps;
  return rest;
}

export async function createBackup(opts: { includePhotos: boolean }): Promise<BackupFile> {
  const db = await getDB();
  const [profile, settings, maintenance, goals, entries, customMetrics, habits, habitLogs, achievements, reminders, photoMeta] = await Promise.all([
    db.get('kv', 'profile'),
    db.get('kv', 'settings'),
    db.get('kv', 'maintenance'),
    db.getAll('goals'),
    db.getAll('entries'),
    db.getAll('customMetrics'),
    db.getAll('habits'),
    db.getAll('habitLogs'),
    db.getAll('achievements'),
    db.getAll('reminders'),
    db.getAll('photoMeta'),
  ]);
  const photos: BackupData['photos'] = [];
  if (opts.includePhotos) {
    for (const meta of photoMeta) {
      const rec = await db.get('photoBlobs', meta.id);
      if (!rec) continue;
      photos.push({ meta, image: await blobToBase64(rec.blob), thumb: await blobToBase64(rec.thumb) });
    }
  }
  const data = {
    profile: (profile as BackupData['profile']) ?? null,
    settings: settings ? portableSettings(settings as Settings) : {},
    maintenance: (maintenance as BackupData['maintenance']) ?? null,
    goals,
    entries,
    customMetrics,
    habits,
    habitLogs,
    achievements,
    reminders,
    photos,
  } as BackupData;
  return { format: 'forma-backup', version: 1, createdAt: new Date().toISOString(), checksum: await sha256Hex(canonicalJSON(data)), data };
}

export interface BackupSummary {
  createdAt: string;
  entries: number;
  habits: number;
  habitLogs: number;
  photos: number;
  goals: number;
  hasProfile: boolean;
  range: { from: string; to: string } | null;
}

export type ParseResult = { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: string };

/** Parses, validates and integrity-checks a backup file before anything is written. */
export async function parseBackup(file: Blob): Promise<ParseResult> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, error: 'Файл слишком большой для резервной копии FORMA.' };
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'Файл повреждён или не является JSON.' };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Файл не прошёл проверку структуры${first ? ` (${first.path.join('.')})` : ''}.` };
  }
  const b = parsed.data;
  const sum = await sha256Hex(canonicalJSON(b.data));
  if (sum !== b.checksum) return { ok: false, error: 'Контрольная сумма не совпадает: файл изменён или повреждён.' };
  const ids = new Set(b.data.habits.map((h) => h.id));
  if (b.data.habitLogs.some((l) => !ids.has(l.habitId))) return { ok: false, error: 'Нарушена связность данных: отметки ссылаются на несуществующие привычки.' };
  const dates = b.data.entries.map((e) => e.date).sort();
  return {
    ok: true,
    backup: b,
    summary: {
      createdAt: b.createdAt,
      entries: b.data.entries.length,
      habits: b.data.habits.length,
      habitLogs: b.data.habitLogs.length,
      photos: b.data.photos.length,
      goals: b.data.goals.length,
      hasProfile: !!b.data.profile,
      range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    },
  };
}

/**
 * Writes a validated backup. `replace` clears local data first (PIN and device
 * settings are kept); `merge` adds records whose ids are not present yet.
 * Everything happens in one transaction: either all of it is written or nothing.
 */
export async function restoreBackup(b: BackupFile, mode: 'replace' | 'merge'): Promise<void> {
  const db = await getDB();
  const d = b.data;
  const tx = db.transaction(['kv', ...DATA_STORES], 'readwrite');
  const ops: Promise<unknown>[] = [];
  const currentSettings = ((await tx.objectStore('kv').get('settings')) as Settings | undefined) ?? null;
  if (mode === 'replace') {
    for (const s of DATA_STORES) ops.push(tx.objectStore(s).clear());
    ops.push(tx.objectStore('kv').delete('profile'), tx.objectStore('kv').delete('maintenance'));
  }
  const putAll = async <T extends { id: string }>(store: Exclude<(typeof DATA_STORES)[number], 'photoBlobs' | 'reminderState'>, rows: T[]) => {
    const os = tx.objectStore(store);
    for (const r of rows) {
      if (mode === 'merge' && (await os.getKey(r.id))) continue;
      ops.push(os.put(r as never));
    }
  };
  if (d.profile && (mode === 'replace' || !(await tx.objectStore('kv').get('profile')))) ops.push(tx.objectStore('kv').put(d.profile, 'profile'));
  if (d.maintenance && (mode === 'replace' || !(await tx.objectStore('kv').get('maintenance')))) ops.push(tx.objectStore('kv').put(d.maintenance, 'maintenance'));
  const settings = {
    ...(currentSettings ?? {}),
    ...(mode === 'replace' ? d.settings : {}),
    pin: currentSettings?.pin ?? null,
    biometricCredentialId: currentSettings?.biometricCredentialId ?? null,
    onboarded: true,
  };
  ops.push(tx.objectStore('kv').put(settings as Settings, 'settings'));
  await putAll('goals', d.goals);
  await putAll('entries', d.entries);
  await putAll('customMetrics', d.customMetrics);
  await putAll('habits', d.habits);
  await putAll('habitLogs', d.habitLogs);
  await putAll('achievements', d.achievements);
  await putAll('reminders', d.reminders);
  for (const p of d.photos) {
    if (mode === 'merge' && (await tx.objectStore('photoMeta').getKey(p.meta.id))) continue;
    ops.push(tx.objectStore('photoMeta').put(p.meta));
    ops.push(tx.objectStore('photoBlobs').put({ id: p.meta.id, blob: base64ToBlob(p.image, p.meta.mime), thumb: base64ToBlob(p.thumb, 'image/jpeg') }));
  }
  await Promise.all([...ops, tx.done]);
}
