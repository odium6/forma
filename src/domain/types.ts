/**
 * Core data model of FORMA. All persisted entities live here so that the
 * storage layer, backup schema and business logic share one definition.
 * Dates are local calendar dates in ISO form (YYYY-MM-DD); times are HH:mm.
 */

export type ISODate = string;
export type HHmm = string;

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type ThemeMode = 'light' | 'dark' | 'system';

export const BUILTIN_MEASUREMENTS = [
  'waist',
  'chest',
  'hips',
  'neck',
  'arm',
  'forearm',
  'thigh',
  'calf',
] as const;
export type BuiltinMeasurementKey = (typeof BUILTIN_MEASUREMENTS)[number];
/** Built-in keys or `custom:<id>` for user-defined parameters. */
export type MeasurementKey = BuiltinMeasurementKey | `custom:${string}`;

export interface CustomMetric {
  id: string;
  name: string;
  unit: string;
  /** Whether a smaller value is the desired direction (used only for wording). */
  lowerIsBetter: boolean | null;
  createdAt: number;
}

export type BodyShapeGoal = 'leaner' | 'athletic' | 'stronger' | 'healthier' | 'maintain' | 'custom';

export interface Profile {
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activity: ActivityLevel;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  /** Weight at the moment the goal was set. Progress is measured from here. */
  startWeight: number;
  startDate: ISODate;
  targetWeight: number | null;
  targetBodyFat: number | null;
  targetDate: ISODate | null;
  /** Desired body-measurement targets, e.g. waist 80 cm. */
  targetMeasurements: Partial<Record<MeasurementKey, number>>;
  shape: BodyShapeGoal;
  shapeNote: string;
  /** Chosen pace as % of body weight per week (positive number). */
  pacePctPerWeek: number;
  status: 'active' | 'achieved' | 'archived';
  achievedAt: ISODate | null;
  createdAt: number;
}

export interface Maintenance {
  enabled: boolean;
  centerWeight: number;
  /** Half-width of the tolerated band, kg. */
  toleranceKg: number;
  startedAt: ISODate;
}

export interface Entry {
  id: string;
  date: ISODate;
  time: HHmm;
  weight: number | null;
  bodyFat: number | null;
  measurements: Partial<Record<MeasurementKey, number>>;
  note: string;
  source: 'manual' | 'import';
  createdAt: number;
  updatedAt: number;
}

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // 0 = Monday … 6 = Sunday
  | { type: 'timesPerWeek'; times: number };

export interface HabitScheduleVersion {
  from: ISODate;
  schedule: HabitSchedule;
}

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** `check`: done / not done. `count`: reach `target` units (e.g. 8 glasses). `limit`: stay at or under `target`. */
  kind: 'check' | 'count' | 'limit';
  target: number;
  unit: string;
  /** Schedule history: editing a schedule appends a version, so past days keep the rules they had. */
  schedules: HabitScheduleVersion[];
  createdAt: number;
  archivedAt: number | null;
  /** Highest streak ever observed; never decreases (protects records from schedule edits). */
  bestStreak: number;
  order: number;
}

export interface HabitLog {
  /** `${habitId}|${date}` */
  id: string;
  habitId: string;
  date: ISODate;
  value: number;
  updatedAt: number;
}

export type PhotoCategory = 'front' | 'side' | 'back' | 'other';

export interface PhotoMeta {
  id: string;
  date: ISODate;
  category: PhotoCategory;
  note: string;
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  createdAt: number;
}

export interface PhotoRecord extends PhotoMeta {
  blob: Blob;
  thumb: Blob;
}

export interface UnlockedAchievement {
  id: string;
  /** Date of the event that earned it (from data, not from evaluation time). */
  date: ISODate;
  unlockedAt: number;
}

export type WeekParity = 'all' | 'even' | 'odd';

export interface Reminder {
  id: string;
  enabled: boolean;
  label: string;
  kind: 'weigh' | 'habits' | 'photo' | 'custom';
  time: HHmm;
  days: number[]; // 0 = Monday … 6 = Sunday
  parity: WeekParity;
  createdAt: number;
  /** Set for a streak reminder attached to a habit. */
  habitId?: string;
}

export interface Settings {
  theme: ThemeMode;
  glass: 'auto' | 'reduced';
  onboarded: boolean;
  motivation: boolean;
  notificationsEnabled: boolean;
  quietHours: { enabled: boolean; start: HHmm; end: HHmm };
  snoozeMinutes: number;
  /** Skip a reminder when its action (weighing, photo, habits) is already done today. */
  skipIfDone: boolean;
  pin: { hash: string; salt: string; iterations: number } | null;
  biometricCredentialId: string | null;
  lockScope: 'photos' | 'app';
  autoLockMinutes: number;
  lastBackupAt: number | null;
  persistentStorage: boolean | null;
  includePhotosInReports: boolean;
  /** Device token for server push reminders (null = only in-app reminders). */
  pushId: string | null;
  /** What the big flame on the home screen counts: 'weigh' or a habit id. */
  mainStreak: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  glass: 'auto',
  onboarded: false,
  motivation: true,
  notificationsEnabled: false,
  quietHours: { enabled: true, start: '22:30', end: '07:00' },
  snoozeMinutes: 30,
  skipIfDone: false,
  pin: null,
  biometricCredentialId: null,
  lockScope: 'photos',
  autoLockMinutes: 3,
  lastBackupAt: null,
  persistentStorage: null,
  includePhotosInReports: false,
  pushId: null,
  mainStreak: null,
};

/** Everything except photo binaries: small enough to keep in memory. */
export interface AppData {
  profile: Profile | null;
  goals: Goal[];
  maintenance: Maintenance | null;
  entries: Entry[];
  customMetrics: CustomMetric[];
  habits: Habit[];
  habitLogs: HabitLog[];
  photos: PhotoMeta[];
  achievements: UnlockedAchievement[];
  reminders: Reminder[];
  settings: Settings;
}
