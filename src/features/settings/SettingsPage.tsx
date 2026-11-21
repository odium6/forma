import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import { requestPersistence, storageEstimate } from '@/app/pwa';
import { useLock } from '@/app/lock';
import type { ActivityLevel, Reminder, Sex } from '@/domain/types';
import { deleteReminder, refreshAfterImport, saveProfile, saveReminder, saveSettings, useData, wipeAll } from '@/state/store';
import { computeSummary } from '@/lib/summary';
import { ACTIVITY_LABELS, LIMITS, TYPICAL } from '@/lib/math/body';
import { formatDate, WEEKDAYS_SHORT } from '@/lib/dates';
import { parseDecimal, plural, uid } from '@/lib/format';
import { describeReminder, nextOccurrence, remindersToICS } from '@/lib/reminders';
import { isIOS, isStandalone, notificationPermission, requestNotificationPermission, showReminder, type PermissionState } from '@/lib/notify';
import { createBackup, parseBackup, restoreBackup, type BackupSummary } from '@/lib/backup/backup';
import type { BackupFile } from '@/lib/backup/schema';
import { entriesCSV, habitsCSV, saveFile, stamp } from '@/lib/export/files';
import { biometricsAvailable, hashPin, isValidPin, registerBiometric } from '@/lib/security';
import { disableServerPush, enableServerPush, pushSupported, sendTestPush, serverPushConfigured } from '@/lib/push';
import { GoalCard } from '@/features/progress/GoalCard';
import { ChipGroup, NumberField, Notice, Segmented, ToggleRow, fieldValid } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { LogoMark } from '@/ui/Logo';
import './settings.css';

export default function SettingsPage() {
  const data = useData();
  const s = useMemo(() => computeSummary(data), [data]);
  useEffect(() => {
    if (location.hash.includes('#goal')) document.getElementById('goal')?.scrollIntoView();
  }, []);
  return (
    <div className="page settings">
      <PageHeader title="Настройки" />
      <div className="settings-grid">
        <div className="col">
          <ProfileSection />
          <GoalCard data={data} summary={s} />
          <AppearanceSection />
          <NotificationsSection />
        </div>
        <div className="col">
          <PrivacySection />
          <DataSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { profile } = useData();
  const [open, setOpen] = useState(false);
  const { toast } = useFeedback();
  const [name, setName] = useState(profile?.name ?? '');
  const [sex, setSex] = useState<Sex>(profile?.sex ?? 'female');
  const [year, setYear] = useState(String(profile?.birthYear ?? ''));
  const [height, setHeight] = useState(String(profile?.heightCm ?? '').replace('.', ','));
  const [activity, setActivity] = useState<ActivityLevel>(profile?.activity ?? 'light');
  const valid = fieldValid(year, LIMITS.birthYear.min, LIMITS.birthYear.max, true) && fieldValid(height, LIMITS.height.min, LIMITS.height.max, true);
  if (!profile) return null;
  const age = new Date().getFullYear() - profile.birthYear;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Профиль</h2>
        <button className="btn sm" onClick={() => setOpen(true)}><Icon name="edit" size={16} /> Изменить</button>
      </div>
      <dl className="kv">
        {profile.name && <><dt>Имя</dt><dd>{profile.name}</dd></>}
        <dt>Пол</dt><dd>{profile.sex === 'female' ? 'Женский' : 'Мужской'}</dd>
        <dt>Возраст</dt><dd className="num">{age} {plural(age, ['год', 'года', 'лет'])}</dd>
        <dt>Рост</dt><dd className="num">{String(profile.heightCm).replace('.', ',')} см</dd>
        <dt>Активность</dt><dd>{ACTIVITY_LABELS[profile.activity].title}</dd>
      </dl>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Профиль"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Отмена</button>
            <button
              className="btn primary"
              disabled={!valid}
              onClick={async () => {
                await saveProfile({ ...profile, name: name.trim().slice(0, 60), sex, birthYear: parseDecimal(year)!, heightCm: parseDecimal(height)!, activity });
                toast('Профиль сохранён', { tone: 'success' });
                setOpen(false);
              }}
            >
              Сохранить
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="p-name">Имя</label>
          <input id="p-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ChipGroup label="Пол" value={sex} onChange={(v) => setSex(v as Sex)} options={[{ value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }]} />
        <div className="grid-2">
          <NumberField label="Год рождения" value={year} onChange={setYear} min={LIMITS.birthYear.min} max={LIMITS.birthYear.max} required />
          <NumberField label="Рост" value={height} onChange={setHeight} suffix="см" min={LIMITS.height.min} typical={TYPICAL.height} max={LIMITS.height.max} required />
        </div>
        <div className="field">
          <label htmlFor="p-act">Активность</label>
          <select id="p-act" className="input" value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)}>
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => <option key={a} value={a}>{ACTIVITY_LABELS[a].title} — {ACTIVITY_LABELS[a].hint}</option>)}
          </select>
        </div>
      </Sheet>
    </section>
  );
}

function AppearanceSection() {
  const { settings } = useData();
  return (
    <section className="card">
      <div className="card-head"><h2>Оформление</h2></div>
      <div className="stack">
        <div className="field">
          <span className="field-label">Тема</span>
          <Segmented label="Тема" value={settings.theme} onChange={(theme) => void saveSettings({ theme })} items={[{ value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }, { value: 'system', label: 'Системная' }]} />
          {settings.theme === 'system' && (
            <span className="field-hint">Сейчас по настройкам устройства: {typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'тёмная' : 'светлая'}</span>
          )}
        </div>
        <ToggleRow
          icon="sparkle"
          title="Liquid Glass"
          hint="Стеклянные кнопки и панели. Выключи, если интерфейс работает медленно."
          checked={settings.glass === 'auto'}
          onChange={(v) => void saveSettings({ glass: v ? 'auto' : 'reduced' })}
        />
      </div>
    </section>
  );
}

const DEFAULT_LABELS: Record<Reminder['kind'], string> = { weigh: 'Взвешивание', habits: 'Привычки', photo: 'Фото прогресса', custom: 'Напоминание' };

function NotificationsSection() {
  const { settings, reminders } = useData();
  const { toast } = useFeedback();
  const [perm, setPerm] = useState<PermissionState>(notificationPermission());
  const [editing, setEditing] = useState<Reminder | null>(null);
  const ios = isIOS();
  const standalone = isStandalone();

  const enable = async (v: boolean) => {
    if (v) {
      const p = await requestNotificationPermission();
      setPerm(p);
      if (p !== 'granted') {
        toast(p === 'unsupported' ? 'Браузер не поддерживает уведомления' : 'Разрешение на уведомления не выдано', { tone: 'error' });
        return;
      }
    }
    await saveSettings({ notificationsEnabled: v });
  };

  const [pushBusy, setPushBusy] = useState(false);
  const serverPush = serverPushConfigured();
  const pushOn = !!settings.pushId;
  const needsInstall = ios && !standalone;

  const toggleServerPush = async (v: boolean) => {
    setPushBusy(true);
    try {
      if (!v) {
        await disableServerPush();
        toast('Фоновые уведомления выключены');
        return;
      }
      const r = await enableServerPush();
      setPerm(notificationPermission());
      const msg: Record<typeof r, string> = {
        ok: 'Фоновые уведомления включены',
        denied: 'Разрешение на уведомления не выдано. Его можно включить в настройках браузера или iOS.',
        unsupported: 'Этот браузер не поддерживает push-уведомления',
        'not-configured': 'Сервер уведомлений не настроен в этой сборке',
        'not-installed': 'Сначала установи FORMA на экран «Домой»',
        error: 'Не удалось подключиться к серверу уведомлений. Проверь интернет и попробуй ещё раз.',
      };
      toast(msg[r], { tone: r === 'ok' ? 'success' : 'error' });
    } finally {
      setPushBusy(false);
    }
  };

  const testNotification = async () => {
    if (pushOn) {
      const ok = await sendTestPush().catch(() => false);
      toast(ok ? 'Тестовое уведомление отправлено. Можно закрыть приложение — оно всё равно придёт.' : 'Не удалось отправить тест (не чаще раза в 30 секунд)', { tone: ok ? 'success' : 'error' });
      return;
    }
    if (!reminders.length || !(await showReminder(reminders[0], `test${Date.now()}`))) toast('Не удалось показать уведомление', { tone: 'error' });
  };

  const newReminder = (): Reminder => ({ id: uid(), enabled: true, label: DEFAULT_LABELS.weigh, kind: 'weigh', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], parity: 'all', createdAt: Date.now() });

  return (
    <section className="card">
      <div className="card-head"><h2>Уведомления</h2></div>
      {perm === 'unsupported' || needsInstall ? (
        <Notice tone="warn">
          {needsInstall ? 'На iPhone уведомления доступны только после установки FORMA на экран «Домой» (Safari → Поделиться → На экран «Домой»), iOS 16.4+. Затем открой FORMA с экрана «Домой» и включи уведомления здесь.' : 'Этот браузер не поддерживает уведомления.'}
        </Notice>
      ) : (
        <>
          {serverPush && pushSupported() && (
            <ToggleRow
              icon="bell"
              title="Уведомления при закрытом приложении"
              hint={
                perm === 'denied'
                  ? 'Запрещены в настройках браузера'
                  : 'Вес, фото и заметки никуда не передаются'
              }
              checked={pushOn && perm === 'granted'}
              onChange={toggleServerPush}
              disabled={pushBusy || perm === 'denied'}
            />
          )}
          {!pushOn && (
            <ToggleRow icon="bell" title="Напоминания в приложении" hint={perm === 'denied' ? 'Запрещены в настройках браузера' : 'Пока FORMA открыта'} checked={settings.notificationsEnabled && perm === 'granted'} onChange={enable} disabled={perm === 'denied'} />
          )}
        </>
      )}
      <ToggleRow icon="sparkle" title="Мотивационные сообщения" hint="Отдельно от напоминаний: вдохновляющие фразы в уведомлениях и на главной" checked={settings.motivation} onChange={(v) => void saveSettings({ motivation: v })} />
      <ToggleRow icon="check" title="Не напоминать, если уже сделано" hint={settings.skipIfDone ? 'Напоминание не придёт, если сегодня уже есть взвешивание, фото или все привычки отмечены' : 'Напоминания приходят всегда'} checked={settings.skipIfDone} onChange={(v) => void saveSettings({ skipIfDone: v })} />
      <ToggleRow icon="moon" title="Тихие часы" hint={settings.quietHours.enabled ? `${settings.quietHours.start}–${settings.quietHours.end}: напоминания переносятся на конец периода` : 'Выключены'} checked={settings.quietHours.enabled} onChange={(v) => void saveSettings({ quietHours: { ...settings.quietHours, enabled: v } })} />
      {settings.quietHours.enabled && (
        <div className="grid-2" style={{ margin: '4px 0 12px' }}>
          <div className="field"><label htmlFor="q-s">Начало</label><input id="q-s" className="input" type="time" value={settings.quietHours.start} onChange={(e) => e.target.value && void saveSettings({ quietHours: { ...settings.quietHours, start: e.target.value } })} /></div>
          <div className="field"><label htmlFor="q-e">Конец</label><input id="q-e" className="input" type="time" value={settings.quietHours.end} onChange={(e) => e.target.value && void saveSettings({ quietHours: { ...settings.quietHours, end: e.target.value } })} /></div>
        </div>
      )}
      <div className="field" style={{ margin: '8px 0 4px' }}>
        <label htmlFor="snooze">«Отложить» на</label>
        <select id="snooze" className="input" value={settings.snoozeMinutes} onChange={(e) => void saveSettings({ snoozeMinutes: Number(e.target.value) })}>
          {[10, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} минут</option>)}
        </select>
      </div>
      <div className="row between" style={{ marginTop: 16 }}>
        <h3>Расписание</h3>
        <button className="btn sm" onClick={() => setEditing(newReminder())} data-testid="add-reminder"><Icon name="plus" size={16} /> Добавить</button>
      </div>
      {reminders.length === 0 ? (
        <p className="small muted" style={{ marginTop: 8 }}>Нет напоминаний. Например: взвешивание в 8:00 по будням.</p>
      ) : (
        <div className="list">
          {reminders.map((r) => {
            const next = nextOccurrence(r, new Date(), settings.quietHours);
            return (
              <button key={r.id} className="list-item" onClick={() => setEditing(r)}>
                <span className="list-icon"><Icon name={r.kind === 'weigh' ? 'scale' : r.kind === 'habits' ? 'habits' : r.kind === 'photo' ? 'camera' : 'bell'} size={18} /></span>
                <span className="grow">
                  <span className="strong">{r.label}</span>
                  <span className="small muted" style={{ display: 'block' }}>
                    {describeReminder(r)}
                    {r.enabled && next ? ` · след.: ${formatDate(next.toISOString().slice(0, 10))} ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}` : !r.enabled ? ' · выключено' : ''}
                  </span>
                </span>
                <Icon name="right" size={18} className="faint" />
              </button>
            );
          })}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn sm" disabled={perm !== 'granted' || (!pushOn && !reminders.length)} onClick={testNotification}>
          Проверить уведомление
        </button>
        <button className="btn sm" disabled={!reminders.some((r) => r.enabled)} onClick={() => saveFile(new Blob([remindersToICS(reminders)], { type: 'text/calendar' }), 'forma-reminders.ics')}>
          <Icon name="calendar" size={16} /> Добавить в календарь
        </button>
      </div>
      {editing && <ReminderSheet reminder={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function ReminderSheet({ reminder, onClose }: { reminder: Reminder; onClose: () => void }) {
  const { reminders } = useData();
  const { confirm } = useFeedback();
  const [r, setR] = useState(reminder);
  const exists = reminders.some((x) => x.id === r.id);
  const set = (p: Partial<Reminder>) => setR((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={exists ? 'Напоминание' : 'Новое напоминание'}
      footer={
        <>
          {exists && (
            <button className="btn danger icon" aria-label="Удалить напоминание" onClick={async () => { if (await confirm({ title: 'Удалить напоминание?', danger: true, confirm: 'Удалить' })) { await deleteReminder(r.id); onClose(); } }}>
              <Icon name="trash" size={18} />
            </button>
          )}
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!r.days.length || !r.label.trim()} onClick={async () => { await saveReminder({ ...r, label: r.label.trim().slice(0, 80) }); onClose(); }} data-testid="reminder-save">Сохранить</button>
        </>
      }
    >
      <ToggleRow title="Включено" checked={r.enabled} onChange={(enabled) => set({ enabled })} />
      <div className="field">
        <span className="field-label">Тип</span>
        <ChipGroup label="Тип напоминания" value={r.kind} onChange={(v) => set({ kind: v as Reminder['kind'], label: r.label === DEFAULT_LABELS[r.kind] ? DEFAULT_LABELS[v as Reminder['kind']] : r.label })} options={(Object.keys(DEFAULT_LABELS) as Reminder['kind'][]).map((k) => ({ value: k, label: DEFAULT_LABELS[k] }))} />
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="r-label">Название</label><input id="r-label" className="input" maxLength={80} value={r.label} onChange={(e) => set({ label: e.target.value })} /></div>
        <div className="field"><label htmlFor="r-time">Время</label><input id="r-time" className="input" type="time" value={r.time} onChange={(e) => e.target.value && set({ time: e.target.value })} /></div>
      </div>
      <div className="field">
        <span className="field-label">Дни недели</span>
        <ChipGroup label="Дни недели" multiple value={r.days} onChange={(v) => set({ days: (v as number[]).sort() })} options={WEEKDAYS_SHORT.map((w, i) => ({ value: i, label: w }))} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="link-btn small" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>Каждый день</button>
          <button type="button" className="link-btn small" onClick={() => set({ days: [0, 1, 2, 3, 4] })}>Будни</button>
          <button type="button" className="link-btn small" onClick={() => set({ days: [5, 6] })}>Выходные</button>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Недели</span>
        <Segmented label="Чередование недель" value={r.parity} onChange={(parity) => set({ parity })} items={[{ value: 'all', label: 'Каждую' }, { value: 'even', label: 'Чётные' }, { value: 'odd', label: 'Нечётные' }]} />
        <span className="field-hint">Чтобы получать несколько напоминаний в день, добавь их отдельно с разным временем.</span>
      </div>
    </Sheet>
  );
}

function PrivacySection() {
  const { settings } = useData();
  const { lock } = useLock();
  const { toast, confirm } = useFeedback();
  const [pinOpen, setPinOpen] = useState(false);
  const [bio, setBio] = useState(false);
  useEffect(() => {
    void biometricsAvailable().then(setBio);
  }, []);
  return (
    <section className="card">
      <div className="card-head"><h2>Приватность и защита</h2></div>
      <div className="list">
        <button className="list-item" onClick={() => setPinOpen(true)} data-testid="pin-setup">
          <span className="list-icon"><Icon name="lock" size={18} /></span>
          <span className="grow"><span className="strong">PIN-код</span><span className="small muted" style={{ display: 'block' }}>{settings.pin ? 'Установлен' : 'Не установлен'}</span></span>
          <Icon name="right" size={18} className="faint" />
        </button>
        {settings.pin && (
          <>
            <div className="list-item">
              <span className="list-icon"><Icon name="shield" size={18} /></span>
              <span className="grow strong">Что защищать</span>
              <Segmented label="Область защиты" value={settings.lockScope} onChange={(lockScope) => void saveSettings({ lockScope })} items={[{ value: 'photos', label: 'Фото' }, { value: 'app', label: 'Всё' }]} />
            </div>
            <div className="list-item">
              <span className="list-icon"><Icon name="clock" size={18} /></span>
              <span className="grow strong">Автоблокировка</span>
              <select className="input" style={{ width: 140, minHeight: 40 }} aria-label="Автоблокировка" value={settings.autoLockMinutes} onChange={(e) => void saveSettings({ autoLockMinutes: Number(e.target.value) })}>
                {[0, 1, 3, 5, 15, 30].map((m) => <option key={m} value={m}>{m === 0 ? 'сразу' : `через ${m} мин`}</option>)}
              </select>
            </div>
            {bio && (
              <ToggleRow
                icon="fingerprint"
                title="Биометрия"
                hint="Face ID / Touch ID / Windows Hello — как быстрый способ разблокировки, PIN остаётся запасным"
                checked={!!settings.biometricCredentialId}
                onChange={async (v) => {
                  if (!v) return void saveSettings({ biometricCredentialId: null });
                  try {
                    const id = await registerBiometric();
                    if (id) await saveSettings({ biometricCredentialId: id });
                  } catch {
                    toast('Биометрия недоступна или отменена', { tone: 'error' });
                  }
                }}
              />
            )}
            <button className="list-item" onClick={lock}>
              <span className="list-icon"><Icon name="lock" size={18} /></span>
              <span className="grow strong">Заблокировать сейчас</span>
            </button>
            <button
              className="list-item"
              onClick={async () => {
                if (await confirm({ title: 'Отключить PIN-код?', text: 'Защита фото и приложения будет снята.', danger: true, confirm: 'Отключить' })) {
                  await saveSettings({ pin: null, biometricCredentialId: null });
                  toast('PIN-код отключён');
                }
              }}
            >
              <span className="list-icon"><Icon name="close" size={18} /></span>
              <span className="grow" style={{ color: 'var(--danger)' }}>Отключить PIN</span>
            </button>
          </>
        )}
      </div>
      <p className="xs faint" style={{ marginTop: 10 }}>
        Блокировка скрывает данные от посторонних глаз, но не заменяет код-пароль самого телефона.
      </p>
      {pinOpen && <PinSheet onClose={() => setPinOpen(false)} />}
    </section>
  );
}

function PinSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const ok = isValidPin(a) && a === b;
  return (
    <Sheet
      open
      onClose={onClose}
      title="PIN-код"
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={!ok}
            data-testid="pin-save"
            onClick={async () => {
              await saveSettings({ pin: await hashPin(a) });
              try {
                localStorage.setItem('forma-pin-len', String(a.length));
              } catch {
                /* optional auto-submit hint */
              }
              toast('PIN-код установлен', { tone: 'success' });
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pin-a">Новый PIN (4–8 цифр)</label>
        <input id="pin-a" className="input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} data-testid="pin-a" />
      </div>
      <div className="field">
        <label htmlFor="pin-b">Повтори PIN</label>
        <input id="pin-b" className="input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} aria-invalid={b.length > 0 && a !== b} data-testid="pin-b" />
        {b.length >= a.length && b.length > 0 && a !== b && <span className="field-error">PIN-коды не совпадают</span>}
      </div>
      <Notice tone="warn">Если забудешь PIN, восстановить его нельзя. Доступ вернётся только после удаления данных или восстановления из резервной копии.</Notice>
    </Sheet>
  );
}

function DataSection() {
  const data = useData();
  const { toast, confirm } = useFeedback();
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(data.settings.persistentStorage);
  const [restore, setRestore] = useState<{ backup: BackupFile; summary: BackupSummary } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void storageEstimate().then(setEst);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
  }, [data.photos.length, data.entries.length]);

  const backup = async () => {
    setBusy(true);
    try {
      const b = await createBackup({ includePhotos: withPhotos });
      const res = await saveFile(new Blob([JSON.stringify(b)], { type: 'application/json' }), `forma-backup-${stamp()}${withPhotos ? '' : '-no-photos'}.json`);
      if (res !== 'cancelled') {
        await saveSettings({ lastBackupAt: Date.now() });
        toast('Резервная копия сохранена', { tone: 'success' });
      }
    } catch (e) {
      console.error(e);
      toast('Не удалось создать резервную копию', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    const res = await parseBackup(f);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) return toast(res.error, { tone: 'error' });
    setRestore({ backup: res.backup, summary: res.summary });
  };

  const daysSince = data.settings.lastBackupAt ? Math.floor((Date.now() - data.settings.lastBackupAt) / 86_400_000) : null;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2).replace('.', ',')} МБ`;

  return (
    <section className="card">
      <div className="card-head"><h2>Данные</h2></div>
      {(daysSince == null || daysSince > 14) && (
        <Notice tone="warn">
          {daysSince == null ? 'Резервной копии ещё нет.' : `Последняя резервная копия — ${daysSince} ${plural(daysSince, ['день', 'дня', 'дней'])} назад.`} Данные хранятся только на этом устройстве — сохрани копию, чтобы не потерять их.
        </Notice>
      )}
      <div className="stack" style={{ marginTop: 12 }}>
        <ToggleRow icon="image" title="Включать фото" hint="Копия с фото может быть большой" checked={withPhotos} onChange={setWithPhotos} />
        <div className="row wrap">
          <button className="btn primary" onClick={backup} disabled={busy} data-testid="backup-create"><Icon name="download" size={18} /> Резервная копия</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="backup-restore"><Icon name="upload" size={18} /> Восстановить</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} data-testid="backup-input" />
        </div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => saveFile(new Blob([entriesCSV(data.entries, data.customMetrics)], { type: 'text/csv' }), `forma-entries-${stamp()}.csv`)}>Измерения CSV</button>
          <button className="btn sm" onClick={() => saveFile(new Blob([habitsCSV(data.habits, data.habitLogs)], { type: 'text/csv' }), `forma-habits-${stamp()}.csv`)}>Привычки CSV</button>
        </div>
        <dl className="kv small">
          <dt>Записей</dt><dd className="num">{data.entries.length}</dd>
          <dt>Фото</dt><dd className="num">{data.photos.length}</dd>
          {est && <><dt>Занято</dt><dd className="num">{mb(est.usage)} из {mb(est.quota)}</dd></>}
          <dt>Защита от автоочистки</dt>
          <dd>
            {persisted ? 'включена' : (
              <button className="link-btn" onClick={async () => { const p = await requestPersistence(); setPersisted(p); await saveSettings({ persistentStorage: p }); toast(p ? 'Включено: браузер не будет удалять данные FORMA' : 'Браузер не разрешил. На iPhone помогает установка на экран «Домой».'); }}>
                включить
              </button>
            )}
          </dd>
          {data.settings.lastBackupAt && <><dt>Последняя копия</dt><dd>{formatDate(new Date(data.settings.lastBackupAt).toISOString().slice(0, 10))}</dd></>}
        </dl>
        <div className="divider" />
        <button
          className="btn danger"
          style={{ alignSelf: 'flex-start' }}
          data-testid="wipe"
          onClick={async () => {
            const ok = await confirm({
              title: 'Удалить все данные?',
              text: 'Профиль, измерения, привычки, фото, достижения и настройки будут безвозвратно удалены с этого устройства. Сначала рекомендуем сделать резервную копию.',
              danger: true,
              confirm: 'Удалить всё',
            });
            if (ok) {
              await wipeAll();
              window.location.hash = '#/';
              toast('Все данные удалены');
            }
          }}
        >
          <Icon name="trash" size={18} /> Удалить все данные
        </button>
      </div>
      {restore && (
        <Sheet open onClose={() => setRestore(null)} title="Восстановление" footer={
          <>
            <button className="btn" onClick={() => setRestore(null)}>Отмена</button>
            <button className="btn" onClick={async () => { await restoreBackup(restore.backup, 'merge'); await refreshAfterImport(); setRestore(null); toast('Данные объединены', { tone: 'success' }); }}>Объединить</button>
            <button
              className="btn danger"
              data-testid="restore-replace"
              onClick={async () => {
                if (!(await confirm({ title: 'Заменить текущие данные?', text: 'Все текущие данные на устройстве будут заменены данными из копии. PIN-код сохранится.', danger: true, confirm: 'Заменить' }))) return;
                await restoreBackup(restore.backup, 'replace');
                await refreshAfterImport();
                setRestore(null);
                toast('Данные восстановлены', { tone: 'success' });
              }}
            >
              Заменить
            </button>
          </>
        }>
          <Notice tone="positive">Файл прошёл проверку структуры и контрольной суммы SHA-256.</Notice>
          <dl className="kv">
            <dt>Создана</dt><dd>{new Date(restore.summary.createdAt).toLocaleString('ru-RU')}</dd>
            <dt>Записей</dt><dd className="num">{restore.summary.entries}</dd>
            {restore.summary.range && <><dt>Период</dt><dd>{formatDate(restore.summary.range.from, { year: true })} — {formatDate(restore.summary.range.to, { year: true })}</dd></>}
            <dt>Привычек</dt><dd className="num">{restore.summary.habits} ({restore.summary.habitLogs} отметок)</dd>
            <dt>Фото</dt><dd className="num">{restore.summary.photos}</dd>
            <dt>Целей</dt><dd className="num">{restore.summary.goals}</dd>
          </dl>
          <p className="small muted">«Объединить» добавит записи, которых нет на устройстве. «Заменить» полностью заменит текущие данные.</p>
        </Sheet>
      )}
    </section>
  );
}

function AboutSection() {
  const standalone = isStandalone();
  const ios = isIOS();
  return (
    <section className="card about">
      <div className="row" style={{ gap: 14 }}>
        <LogoMark size={52} />
        <div>
          <h2>FORMA</h2>
          <p className="small muted">Версия {__APP_VERSION__}</p>
        </div>
      </div>
      {!standalone && (
        <Notice icon="download">
          {ios ? 'Установи FORMA: Safari → «Поделиться» → «На экран „Домой“». Так она работает как обычное приложение и может присылать уведомления.' : 'FORMA можно установить как приложение: меню браузера → «Установить приложение».'}
        </Notice>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        Данные хранятся только на этом устройстве. Без регистрации, рекламы и слежки. Рекомендации FORMA не являются медицинскими.
      </p>
      <a className="small licenses" href="third-party-licenses.txt" target="_blank" rel="noopener">Лицензии</a>
    </section>
  );
}
