import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { loadAll, onNewAchievements, useData } from '@/state/store';
import { useThemeSync } from '@/app/theme';
import { Layout } from '@/app/Layout';
import { LockProvider, LockScreen, useLock } from '@/app/lock';
import { EntryProvider, useOpenEntry } from '@/features/entry/EntrySheet';
import { FeedbackProvider, useFeedback } from '@/ui/feedback';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { startReminderScheduler } from '@/lib/notify';
import { startPushSync, migrateDefaultWeighReminder } from '@/lib/push';
import { useServiceWorker } from '@/app/pwa';
import { HomePage } from '@/features/home/HomePage';
import { LogoMark } from '@/ui/Logo';

// Heavier, less frequently used sections are split into separate chunks.
const Onboarding = lazy(() => import('@/features/onboarding/Onboarding'));
const ProgressPage = lazy(() => import('@/features/progress/ProgressPage'));
const HabitsPage = lazy(() => import('@/features/habits/HabitsPage'));
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'));
const PhotosPage = lazy(() => import('@/features/photos/PhotosPage'));
const AchievementsPage = lazy(() => import('@/features/achievements/AchievementsPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const MorePage = lazy(() => import('@/features/more/MorePage'));

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} aria-busy="true">
      <LogoMark size={64} title="FORMA" />
    </div>
  );
}

function PageFallback() {
  return (
    <div className="page" aria-busy="true">
      <div className="skeleton" style={{ height: 40, width: 180 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}

function AchievementToasts() {
  const { toast } = useFeedback();
  useEffect(() => {
    onNewAchievements((ids) => {
      for (const id of ids) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) toast(`${a.icon} Достижение: ${a.title}`, { tone: 'success' });
      }
    });
    return () => onNewAchievements(null);
  }, [toast]);
  return null;
}

/** Handles deep links like #/?entry=1 (manifest shortcut, notification action). */
function DeepLinks() {
  const loc = useLocation();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  useEffect(() => {
    const p = new URLSearchParams(loc.search);
    if (p.get('entry') === '1') {
      openEntry();
      nav(loc.pathname, { replace: true });
    }
  }, [loc.search, loc.pathname, nav, openEntry]);
  return null;
}

function Shell() {
  const data = useData();
  const { locked } = useLock();
  const appLocked = locked && data.settings.lockScope === 'app';
  useServiceWorker();

  useEffect(() => startReminderScheduler(), []);
  useEffect(() => startPushSync(), []);
  useEffect(() => void migrateDefaultWeighReminder(), []);

  if (!data.settings.onboarded) {
    return (
      <Suspense fallback={<Splash />}>
        <Onboarding />
      </Suspense>
    );
  }
  if (appLocked) return <LockScreen scope="app" />;
  return (
    <EntryProvider>
      <DeepLinks />
      <AchievementToasts />
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/habits" element={<HabitsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/photos" element={<PhotosPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </EntryProvider>
  );
}

function ThemeSync() {
  const { settings } = useData();
  useThemeSync(settings.theme, settings.glass);
  return null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll()
      .then(() => setReady(true))
      .catch((e: unknown) => {
        console.error(e);
        setError('Не удалось открыть локальное хранилище. Возможно, браузер работает в приватном режиме или хранилище отключено.');
      });
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div className="stack" style={{ maxWidth: 380, alignItems: 'center' }}>
          <LogoMark size={56} />
          <h2>FORMA не может запуститься</h2>
          <p className="muted">{error}</p>
          <button className="btn primary" onClick={() => location.reload()}>Повторить</button>
        </div>
      </div>
    );
  }
  if (!ready) return <Splash />;
  return (
    <HashRouter>
      <FeedbackProvider>
        <ThemeSync />
        <LockProvider>
          <Shell />
        </LockProvider>
      </FeedbackProvider>
    </HashRouter>
  );
}
