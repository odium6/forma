import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CustomMetric,
  Entry,
  Goal,
  Habit,
  HabitLog,
  Maintenance,
  PhotoMeta,
  Profile,
  Reminder,
  Settings,
  UnlockedAchievement,
} from '@/domain/types';

export const DB_NAME = 'forma';
export const DB_VERSION = 1;

export interface ReminderState {
  id: string;
  /** Timestamp of the last notification shown — prevents duplicates across tabs/SW. */
  lastFiredAt: number | null;
  snoozedUntil: number | null;
  /** How many times the current occurrence was snoozed (capped to avoid endless repeats). */
  snoozeCount: number;
  skipDate: string | null;
}

export interface FormaDB extends DBSchema {
  kv: {
    key: 'profile' | 'settings' | 'maintenance';
    value: Profile | Settings | Maintenance | null;
  };
  goals: { key: string; value: Goal };
  entries: { key: string; value: Entry; indexes: { byDate: string } };
  customMetrics: { key: string; value: CustomMetric };
  habits: { key: string; value: Habit };
  habitLogs: { key: string; value: HabitLog; indexes: { byHabit: string; byDate: string } };
  photoMeta: { key: string; value: PhotoMeta; indexes: { byDate: string } };
  photoBlobs: { key: string; value: { id: string; blob: Blob; thumb: Blob } };
  achievements: { key: string; value: UnlockedAchievement };
  reminders: { key: string; value: Reminder };
  reminderState: { key: string; value: ReminderState };
}

export type StoreName = 'goals' | 'entries' | 'customMetrics' | 'habits' | 'habitLogs' | 'photoMeta' | 'photoBlobs' | 'achievements' | 'reminders' | 'reminderState';

export const DATA_STORES: StoreName[] = ['goals', 'entries', 'customMetrics', 'habits', 'habitLogs', 'photoMeta', 'photoBlobs', 'achievements', 'reminders', 'reminderState'];

let dbPromise: Promise<IDBPDatabase<FormaDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FormaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FormaDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('kv');
          db.createObjectStore('goals', { keyPath: 'id' });
          db.createObjectStore('entries', { keyPath: 'id' }).createIndex('byDate', 'date');
          db.createObjectStore('customMetrics', { keyPath: 'id' });
          db.createObjectStore('habits', { keyPath: 'id' });
          const logs = db.createObjectStore('habitLogs', { keyPath: 'id' });
          logs.createIndex('byHabit', 'habitId');
          logs.createIndex('byDate', 'date');
          db.createObjectStore('photoMeta', { keyPath: 'id' }).createIndex('byDate', 'date');
          db.createObjectStore('photoBlobs', { keyPath: 'id' });
          db.createObjectStore('achievements', { keyPath: 'id' });
          db.createObjectStore('reminders', { keyPath: 'id' });
          db.createObjectStore('reminderState', { keyPath: 'id' });
        }
      },
      blocked() {
        console.warn('FORMA: database upgrade blocked by another tab');
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** For tests: close and forget the connection. */
export async function resetDBConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
