import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDBConnection } from '@/db/db';
import * as store from '@/state/store';
import { createBackup, parseBackup, restoreBackup, canonicalJSON } from '@/lib/backup/backup';
import { hashPin, verifyPin, isValidPin } from '@/lib/security';

beforeEach(async () => {
  await resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  await store.loadAll();
});

const profile = { name: 'Тест', sex: 'female' as const, birthYear: 1990, heightCm: 168, activity: 'moderate' as const, createdAt: 1, updatedAt: 1 };

describe('store persistence', () => {
  it('saves, reloads, edits and deletes entries', async () => {
    await store.saveProfile(profile);
    const e = await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 70, bodyFat: null, measurements: { waist: 80 }, note: 'утро' });
    await store.addEntry({ date: '2026-01-02', time: '08:00', weight: 69.8, bodyFat: null, measurements: {}, note: '' });
    await resetDBConnection();
    const reloaded = await store.loadAll();
    expect(reloaded.entries).toHaveLength(2);
    expect(reloaded.profile?.name).toBe('Тест');
    await store.updateEntry({ ...e, weight: 70.2 });
    expect(store.getState().entries[0].weight).toBe(70.2);
    await store.deleteEntry(e.id);
    expect(store.getState().entries).toHaveLength(1);
  });
  it('awards achievements once, and they persist', async () => {
    await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 70, bodyFat: null, measurements: {}, note: '' });
    expect(store.getState().achievements.map((a) => a.id)).toContain('first_entry');
    await store.addEntry({ date: '2026-01-02', time: '08:00', weight: 70, bodyFat: null, measurements: {}, note: '' });
    expect(store.getState().achievements.filter((a) => a.id === 'first_entry')).toHaveLength(1);
  });
  it('habit logs set and clear', async () => {
    await store.saveHabit({ id: 'h1', name: 'Вода', icon: '💧', color: '#5ad16c', kind: 'check', target: 1, unit: '', schedules: [{ from: '2026-01-01', schedule: { type: 'daily' } }], createdAt: 0, archivedAt: null, bestStreak: 0, order: 0 });
    await store.setHabitLog('h1', '2026-01-01', 1);
    expect(store.getState().habitLogs).toHaveLength(1);
    await store.setHabitLog('h1', '2026-01-01', null);
    expect(store.getState().habitLogs).toHaveLength(0);
  });
  it('creating a new goal archives the old one and keeps history', async () => {
    await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 90, bodyFat: null, measurements: {}, note: '' });
    await store.createGoal({ startWeight: 90, startDate: '2026-01-01', targetWeight: 80, targetBodyFat: null, targetDate: null, targetMeasurements: {}, shape: 'leaner', shapeNote: '', pacePctPerWeek: 0.5 });
    await store.createGoal({ startWeight: 88, startDate: '2026-02-01', targetWeight: 84, targetBodyFat: null, targetDate: null, targetMeasurements: {}, shape: 'leaner', shapeNote: '', pacePctPerWeek: 0.5 });
    const g = store.getState().goals;
    expect(g.filter((x) => x.status === 'active')).toHaveLength(1);
    expect(g[0].status).toBe('archived');
    expect(store.getState().entries).toHaveLength(1);
  });
  it('wipeAll removes everything', async () => {
    await store.saveProfile(profile);
    await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 70, bodyFat: null, measurements: {}, note: '' });
    await store.wipeAll();
    const d = await store.loadAll();
    expect(d.entries).toHaveLength(0);
    expect(d.profile).toBeNull();
  });
});

describe('backup', () => {
  it('round-trips and rejects tampering', async () => {
    await store.saveProfile(profile);
    await store.saveSettings({ theme: 'dark', onboarded: true, pin: await hashPin('1234') });
    await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 70, bodyFat: 25, measurements: { waist: 80 }, note: '<img src=x onerror=alert(1)>' });
    const b = await createBackup({ includePhotos: false });
    expect(JSON.stringify(b)).not.toContain('"pin"');
    const text = JSON.stringify(b);
    const ok = await parseBackup(new Blob([text]));
    expect(ok.ok).toBe(true);

    const tampered = JSON.parse(text);
    tampered.data.entries[0].weight = 60;
    const bad = await parseBackup(new Blob([JSON.stringify(tampered)]));
    expect(bad.ok).toBe(false);

    await store.wipeAll();
    if (ok.ok) await restoreBackup(ok.backup, 'replace');
    await store.refreshAfterImport();
    const s = store.getState();
    expect(s.entries[0].note).toBe('<img src=x onerror=alert(1)>'); // stored as text, rendered escaped by React
    expect(s.settings.theme).toBe('dark');
    expect(s.profile?.heightCm).toBe(168);
  });
  it('rejects invalid structure and out-of-range values', async () => {
    expect((await parseBackup(new Blob(['not json']))).ok).toBe(false);
    const b = await createBackup({ includePhotos: false });
    const evil = { ...b, data: { ...b.data, entries: [{ id: 'x', date: '2026-01-01', time: '08:00', weight: 9999, bodyFat: null, measurements: {}, note: '', source: 'manual', createdAt: 0, updatedAt: 0 }] } };
    expect((await parseBackup(new Blob([JSON.stringify(evil)]))).ok).toBe(false);
  });
  it('merge keeps existing records and adds new ones', async () => {
    await store.addEntry({ date: '2026-01-01', time: '08:00', weight: 70, bodyFat: null, measurements: {}, note: '' });
    const b = await createBackup({ includePhotos: false });
    await store.addEntry({ date: '2026-01-02', time: '08:00', weight: 69, bodyFat: null, measurements: {}, note: '' });
    await restoreBackup(b, 'merge');
    await store.refreshAfterImport();
    expect(store.getState().entries).toHaveLength(2);
  });
  it('canonical JSON ignores key order', () => {
    expect(canonicalJSON({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJSON({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});

describe('PIN', () => {
  it('hashes with salt and verifies', async () => {
    const a = await hashPin('2580');
    const b = await hashPin('2580');
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).not.toContain('2580');
    expect(await verifyPin('2580', a)).toBe(true);
    expect(await verifyPin('2581', a)).toBe(false);
    expect(isValidPin('12')).toBe(false);
    expect(isValidPin('123456')).toBe(true);
  });
});
