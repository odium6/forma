import { useSyncExternalStore } from 'react';
import { DATA_STORES, getDB } from '@/db/db';
import {
  DEFAULT_SETTINGS,
  type AppData,
  type CustomMetric,
  type Entry,
  type Goal,
  type Habit,
  type HabitLog,
  type ISODate,
  type Maintenance,
  type PhotoMeta,
  type Profile,
  type Reminder,
  type Settings,
} from '@/domain/types';
import { evaluateAchievements } from '@/lib/achievements';
import { habitPeriods, indexLogs, streakRuns } from '@/lib/habits';
import { today } from '@/lib/dates';
import { uid } from '@/lib/format';

/**
 * Single in-memory snapshot of all non-binary data, mirrored to IndexedDB.
 * Every mutation writes to IndexedDB first and only then updates the snapshot,
 * so the UI never shows data that failed to persist.
 */

export const EMPTY_DATA: AppData = {
  profile: null,
  goals: [],
  maintenance: null,
  entries: [],
  customMetrics: [],
  habits: [],
  habitLogs: [],
  photos: [],
  achievements: [],
  reminders: [],
  settings: DEFAULT_SETTINGS,
};

type Listener = () => void;
let state: AppData = EMPTY_DATA;
let loaded = false;
const listeners = new Set<Listener>();
let newAchievementListener: ((ids: string[]) => void) | null = null;

function set(next: AppData) {
  state = next;
  listeners.forEach((l) => l());
}

export function getState(): AppData {
  return state;
}

export function isLoaded(): boolean {
  return loaded;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useData(): AppData {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useSelector<T>(sel: (d: AppData) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

export function onNewAchievements(fn: ((ids: string[]) => void) | null) {
  newAchievementListener = fn;
}

const byDateTime = (a: Entry, b: Entry) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt - b.createdAt;

export async function loadAll(): Promise<AppData> {
  const db = await getDB();
  const [profile, settings, maintenance, goals, entries, customMetrics, habits, habitLogs, photos, achievements, reminders] = await Promise.all([
    db.get('kv', 'profile'),
    db.get('kv', 'settings'),
    db.get('kv', 'maintenance'),
    db.getAll('goals'),
    db.getAll('entries'),
    db.getAll('customMetrics'),
    db.getAll('habits'),
    db.getAll('habitLogs'),
    db.getAll('photoMeta'),
    db.getAll('achievements'),
    db.getAll('reminders'),
  ]);
  const data: AppData = {
    profile: (profile as Profile | undefined) ?? null,
    settings: { ...DEFAULT_SETTINGS, ...((settings as Settings | undefined) ?? {}) },
    maintenance: (maintenance as Maintenance | undefined) ?? null,
    goals: goals.sort((a, b) => a.createdAt - b.createdAt),
    entries: entries.sort(byDateTime),
    customMetrics: customMetrics.sort((a, b) => a.createdAt - b.createdAt),
    habits: habits.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    habitLogs,
    photos: photos.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    achievements,
    reminders: reminders.sort((a, b) => a.time.localeCompare(b.time)),
  };
  loaded = true;
  set(data);
  return data;
}

/** Re-evaluates achievements and persists newly earned ones (earned ones are never revoked). */
async function syncAchievements() {
  const earned = evaluateAchievements(state, today());
  const have = new Set(state.achievements.map((a) => a.id));
  const fresh = earned.filter((e) => !have.has(e.id));
  if (!fresh.length) return;
  const db = await getDB();
  const now = Date.now();
  const recs = fresh.map((f) => ({ id: f.id, date: f.date, unlockedAt: now }));
  const tx = db.transaction('achievements', 'readwrite');
  await Promise.all([...recs.map((r) => tx.store.put(r)), tx.done]);
  set({ ...state, achievements: [...state.achievements, ...recs] });
  newAchievementListener?.(fresh.map((f) => f.id));
}

/** Keeps each habit's stored best streak at least as high as any computed one. */
async function syncBestStreaks(habitIds?: string[]) {
  const idx = indexLogs(state.habitLogs);
  const updates: Habit[] = [];
  for (const h of state.habits) {
    if (habitIds && !habitIds.includes(h.id)) continue;
    const { best } = streakRuns(habitPeriods(h, idx, today()));
    if (best > h.bestStreak) updates.push({ ...h, bestStreak: best });
  }
  if (!updates.length) return;
  const db = await getDB();
  const tx = db.transaction('habits', 'readwrite');
  await Promise.all([...updates.map((u) => tx.store.put(u)), tx.done]);
  const map = new Map(updates.map((u) => [u.id, u]));
  set({ ...state, habits: state.habits.map((h) => map.get(h.id) ?? h) });
}

// ── profile / settings ────────────────────────────────────────────────────────

export async function saveProfile(p: Profile) {
  const db = await getDB();
  const next = { ...p, updatedAt: Date.now() };
  await db.put('kv', next, 'profile');
  set({ ...state, profile: next });
}

export async function saveSettings(patch: Partial<Settings>) {
  const db = await getDB();
  const next = { ...state.settings, ...patch };
  await db.put('kv', next, 'settings');
  set({ ...state, settings: next });
}

export async function setMaintenance(m: Maintenance | null) {
  const db = await getDB();
  await db.put('kv', m, 'maintenance');
  set({ ...state, maintenance: m });
  await syncAchievements();
}

// ── goals ─────────────────────────────────────────────────────────────────────

export async function createGoal(input: Omit<Goal, 'id' | 'createdAt' | 'status' | 'achievedAt'>): Promise<Goal> {
  const db = await getDB();
  const goal: Goal = { ...input, id: uid(), createdAt: Date.now(), status: 'active', achievedAt: null };
  const archived = state.goals.map((g) => (g.status === 'active' ? { ...g, status: 'archived' as const } : g));
  const tx = db.transaction('goals', 'readwrite');
  await Promise.all([...archived.map((g) => tx.store.put(g)), tx.store.put(goal), tx.done]);
  set({ ...state, goals: [...archived, goal] });
  await syncAchievements();
  return goal;
}

export async function updateGoal(goal: Goal) {
  const db = await getDB();
  await db.put('goals', goal);
  set({ ...state, goals: state.goals.map((g) => (g.id === goal.id ? goal : g)) });
  await syncAchievements();
}

// ── entries ───────────────────────────────────────────────────────────────────

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt' | 'source'> & { source?: Entry['source'] };

export async function addEntry(input: EntryInput): Promise<Entry> {
  const db = await getDB();
  const now = Date.now();
  const e: Entry = { source: 'manual', ...input, id: uid(), createdAt: now, updatedAt: now };
  await db.put('entries', e);
  set({ ...state, entries: [...state.entries, e].sort(byDateTime) });
  await syncAchievements();
  return e;
}

export async function updateEntry(e: Entry) {
  const db = await getDB();
  const next = { ...e, updatedAt: Date.now() };
  await db.put('entries', next);
  set({ ...state, entries: state.entries.map((x) => (x.id === e.id ? next : x)).sort(byDateTime) });
  await syncAchievements();
}

export async function deleteEntry(id: string) {
  const db = await getDB();
  await db.delete('entries', id);
  set({ ...state, entries: state.entries.filter((x) => x.id !== id) });
}

export async function addCustomMetric(name: string, unit: string, lowerIsBetter: boolean | null): Promise<CustomMetric> {
  const db = await getDB();
  const m: CustomMetric = { id: uid().slice(0, 8), name: name.trim(), unit: unit.trim(), lowerIsBetter, createdAt: Date.now() };
  await db.put('customMetrics', m);
  set({ ...state, customMetrics: [...state.customMetrics, m] });
  return m;
}

export async function deleteCustomMetric(id: string) {
  const db = await getDB();
  await db.delete('customMetrics', id);
  set({ ...state, customMetrics: state.customMetrics.filter((m) => m.id !== id) });
}

// ── habits ────────────────────────────────────────────────────────────────────

export async function saveHabit(h: Habit) {
  const db = await getDB();
  await db.put('habits', h);
  const exists = state.habits.some((x) => x.id === h.id);
  set({ ...state, habits: exists ? state.habits.map((x) => (x.id === h.id ? h : x)) : [...state.habits, h] });
  await syncBestStreaks([h.id]);
}

export async function deleteHabit(id: string) {
  const db = await getDB();
  const logs = state.habitLogs.filter((l) => l.habitId === id);
  const tx = db.transaction(['habits', 'habitLogs'], 'readwrite');
  await Promise.all([tx.objectStore('habits').delete(id), ...logs.map((l) => tx.objectStore('habitLogs').delete(l.id)), tx.done]);
  set({ ...state, habits: state.habits.filter((h) => h.id !== id), habitLogs: state.habitLogs.filter((l) => l.habitId !== id) });
}

export async function reorderHabits(ids: string[]) {
  const db = await getDB();
  const next = state.habits.map((h) => ({ ...h, order: ids.indexOf(h.id) >= 0 ? ids.indexOf(h.id) : h.order }));
  const tx = db.transaction('habits', 'readwrite');
  await Promise.all([...next.map((h) => tx.store.put(h)), tx.done]);
  set({ ...state, habits: next.sort((a, b) => a.order - b.order) });
}

/** value null removes the log for that day. */
export async function setHabitLog(habitId: string, date: ISODate, value: number | null) {
  const db = await getDB();
  const id = `${habitId}|${date}`;
  if (value == null) {
    await db.delete('habitLogs', id);
    set({ ...state, habitLogs: state.habitLogs.filter((l) => l.id !== id) });
  } else {
    const log: HabitLog = { id, habitId, date, value, updatedAt: Date.now() };
    await db.put('habitLogs', log);
    set({ ...state, habitLogs: [...state.habitLogs.filter((l) => l.id !== id), log] });
  }
  await syncBestStreaks([habitId]);
  await syncAchievements();
}

// ── photos ────────────────────────────────────────────────────────────────────

export async function addPhoto(meta: Omit<PhotoMeta, 'id' | 'createdAt'>, blob: Blob, thumb: Blob): Promise<PhotoMeta> {
  const db = await getDB();
  const m: PhotoMeta = { ...meta, id: uid(), createdAt: Date.now() };
  const tx = db.transaction(['photoMeta', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photoMeta').put(m), tx.objectStore('photoBlobs').put({ id: m.id, blob, thumb }), tx.done]);
  set({ ...state, photos: [m, ...state.photos].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt) });
  await syncAchievements();
  return m;
}

export async function updatePhotoMeta(m: PhotoMeta) {
  const db = await getDB();
  await db.put('photoMeta', m);
  set({ ...state, photos: state.photos.map((p) => (p.id === m.id ? m : p)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt) });
  await syncAchievements();
}

export async function deletePhoto(id: string) {
  const db = await getDB();
  const tx = db.transaction(['photoMeta', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photoMeta').delete(id), tx.objectStore('photoBlobs').delete(id), tx.done]);
  set({ ...state, photos: state.photos.filter((p) => p.id !== id) });
}

export async function getPhotoBlob(id: string, which: 'blob' | 'thumb'): Promise<Blob | null> {
  const db = await getDB();
  const rec = await db.get('photoBlobs', id);
  return rec ? rec[which] : null;
}

// ── reminders ─────────────────────────────────────────────────────────────────

export async function saveReminder(r: Reminder) {
  const db = await getDB();
  await db.put('reminders', r);
  const exists = state.reminders.some((x) => x.id === r.id);
  set({ ...state, reminders: (exists ? state.reminders.map((x) => (x.id === r.id ? r : x)) : [...state.reminders, r]).sort((a, b) => a.time.localeCompare(b.time)) });
}

export async function deleteReminder(id: string) {
  const db = await getDB();
  await Promise.all([db.delete('reminders', id), db.delete('reminderState', id)]);
  set({ ...state, reminders: state.reminders.filter((r) => r.id !== id) });
}

// ── whole-database operations ─────────────────────────────────────────────────

export async function wipeAll() {
  const db = await getDB();
  const tx = db.transaction(['kv', ...DATA_STORES], 'readwrite');
  await Promise.all([tx.objectStore('kv').clear(), ...DATA_STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  try {
    localStorage.removeItem('forma-theme');
  } catch {
    /* storage unavailable */
  }
  set({ ...EMPTY_DATA });
}

export async function refreshAfterImport() {
  await loadAll();
  await syncBestStreaks();
  await syncAchievements();
}
