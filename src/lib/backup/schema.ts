import { z } from 'zod';
import { isISODate } from '@/lib/dates';
import { LIMITS } from '@/lib/math/body';

/**
 * Strict schemas for anything read from an imported file. Unknown keys are stripped,
 * strings are length-limited and numbers are range-checked, so a crafted file can
 * neither inject markup-bearing fields we later render nor corrupt calculations.
 * (React escapes all text anyway; this is defence in depth.)
 */

const isoDate = z.string().refine(isISODate, 'Некорректная дата');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_\-|:.]+$/);
const text = (max: number) => z.string().max(max);
const ts = z.number().int().nonnegative();
const measurementKey = z.string().regex(/^(waist|chest|hips|neck|arm|forearm|thigh|calf|custom:[A-Za-z0-9_-]{1,40})$/);
const measurementValue = z.number().min(LIMITS.measurement.min).max(LIMITS.measurement.max);
const measurements = z.record(measurementKey, measurementValue);

export const profileSchema = z.object({
  name: text(60),
  sex: z.enum(['male', 'female']),
  birthYear: z.number().int().min(LIMITS.birthYear.min).max(new Date().getFullYear()),
  heightCm: z.number().min(LIMITS.height.min).max(LIMITS.height.max),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  createdAt: ts,
  updatedAt: ts,
});

const weight = z.number().min(LIMITS.weight.min).max(LIMITS.weight.max);

export const goalSchema = z.object({
  id,
  startWeight: weight,
  startDate: isoDate,
  targetWeight: weight.nullable(),
  targetBodyFat: z.number().min(LIMITS.bodyFat.min).max(LIMITS.bodyFat.max).nullable(),
  targetDate: isoDate.nullable(),
  targetMeasurements: measurements,
  shape: z.enum(['leaner', 'athletic', 'stronger', 'healthier', 'maintain', 'custom']),
  shapeNote: text(300),
  pacePctPerWeek: z.number().min(0).max(2),
  status: z.enum(['active', 'achieved', 'archived']),
  achievedAt: isoDate.nullable(),
  createdAt: ts,
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  centerWeight: weight,
  toleranceKg: z.number().min(0.2).max(10),
  startedAt: isoDate,
});

export const entrySchema = z.object({
  id,
  date: isoDate,
  time: hhmm,
  weight: weight.nullable(),
  bodyFat: z.number().min(LIMITS.bodyFat.min).max(LIMITS.bodyFat.max).nullable(),
  measurements,
  note: text(1000),
  source: z.enum(['manual', 'import']),
  createdAt: ts,
  updatedAt: ts,
});

export const customMetricSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: text(40).min(1),
  unit: text(12),
  lowerIsBetter: z.boolean().nullable(),
  createdAt: ts,
});

const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }),
  z.object({ type: z.literal('weekdays'), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  z.object({ type: z.literal('timesPerWeek'), times: z.number().int().min(1).max(7) }),
]);

export const habitSchema = z.object({
  id,
  name: text(60).min(1),
  icon: text(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(['check', 'count', 'limit']),
  target: z.number().min(0).max(100000),
  unit: text(16),
  schedules: z.array(z.object({ from: isoDate, schedule: scheduleSchema })).min(1).max(500),
  createdAt: ts,
  archivedAt: ts.nullable(),
  bestStreak: z.number().int().min(0),
  order: z.number().int(),
});

export const habitLogSchema = z.object({
  id: z.string().max(140),
  habitId: id,
  date: isoDate,
  value: z.number().min(0).max(100000),
  updatedAt: ts,
});

export const photoMetaSchema = z.object({
  id,
  date: isoDate,
  category: z.enum(['front', 'side', 'back', 'other']),
  note: text(500),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(0),
  createdAt: ts,
});

export const achievementSchema = z.object({ id: z.string().max(60), date: isoDate, unlockedAt: ts });

export const reminderSchema = z.object({
  id,
  enabled: z.boolean(),
  label: text(80),
  kind: z.enum(['weigh', 'habits', 'photo', 'custom']),
  time: hhmm,
  days: z.array(z.number().int().min(0).max(6)).max(7),
  parity: z.enum(['all', 'even', 'odd']),
  createdAt: ts,
});

export const settingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    glass: z.enum(['auto', 'reduced']),
    onboarded: z.boolean(),
    motivation: z.boolean(),
    notificationsEnabled: z.boolean(),
    quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }),
    snoozeMinutes: z.number().int().min(5).max(240),
    lockScope: z.enum(['photos', 'app']),
    autoLockMinutes: z.number().int().min(1).max(60),
    lastBackupAt: ts.nullable(),
    includePhotosInReports: z.boolean(),
  })
  .partial();

const base64 = z.string().max(40_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const backupSchema = z.object({
  format: z.literal('forma-backup'),
  version: z.literal(1),
  createdAt: z.string(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.object({
    profile: profileSchema.nullable(),
    settings: settingsSchema,
    maintenance: maintenanceSchema.nullable(),
    goals: z.array(goalSchema).max(1000),
    entries: z.array(entrySchema).max(100000),
    customMetrics: z.array(customMetricSchema).max(100),
    habits: z.array(habitSchema).max(500),
    habitLogs: z.array(habitLogSchema).max(500000),
    achievements: z.array(achievementSchema).max(500),
    reminders: z.array(reminderSchema).max(100),
    photos: z.array(z.object({ meta: photoMetaSchema, image: base64, thumb: base64 })).max(5000),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;
export type BackupData = BackupFile['data'];
