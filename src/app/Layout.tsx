import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Button, Menu, TabBar } from 'glisse';
import { Icon, type IconName } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { saveSettings, useData } from '@/state/store';
import type { ThemeMode } from '@/domain/types';
import './layout.css';

export const NAV: { to: string; label: string; icon: IconName; mobile?: boolean }[] = [
  { to: '/', label: 'Главная', icon: 'home', mobile: true },
  { to: '/progress', label: 'Прогресс', icon: 'chart', mobile: true },
  { to: '/habits', label: 'Привычки', icon: 'habits', mobile: true },
  { to: '/calendar', label: 'Календарь', icon: 'calendar' },
  { to: '/photos', label: 'Фото', icon: 'camera', mobile: true },
  { to: '/achievements', label: 'Достижения', icon: 'trophy' },
  { to: '/reports', label: 'Отчёты', icon: 'report' },
  { to: '/settings', label: 'Настройки', icon: 'settings' },
];

const THEME_ITEMS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: 'light', label: 'Светлая', icon: 'sun' },
  { mode: 'dark', label: 'Тёмная', icon: 'moon' },
  { mode: 'system', label: 'Как в системе', icon: 'monitor' },
];

export function ThemeMenu() {
  const { settings } = useData();
  return (
    <Menu
      aria-label="Тема оформления"
      icon={<Icon name={settings.theme === 'dark' ? 'moon' : settings.theme === 'light' ? 'sun' : 'monitor'} size={19} />}
      items={THEME_ITEMS.map((t) => ({
        label: `${t.label}${settings.theme === t.mode ? ' ✓' : ''}`,
        icon: <Icon name={t.icon} size={18} />,
        onSelect: () => void saveSettings({ theme: t.mode }),
      }))}
    />
  );
}

export function useIsDesktop() {
  const q = '(min-width: 960px)';
  const [d, setD] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setD(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}

export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  const desktop = useIsDesktop();

  const mobileItems = NAV.filter((n) => n.mobile);
  const inMobile = mobileItems.some((n) => n.to === loc.pathname);
  const tabValue = inMobile ? loc.pathname : '/more';

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="shell">
      {desktop && (
        <aside className="sidebar">
          <div className="sidebar-top">
            <Logo size={30} />
          </div>
          <button className="btn primary block lg" onClick={() => openEntry()} data-testid="add-entry">
            <Icon name="plus" size={20} /> Внести данные
          </button>
          <nav className="side-nav" aria-label="Разделы">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className="side-link">
                <Icon name={n.icon} size={20} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span className="small muted">Тема</span>
            <ThemeMenu />
          </div>
        </aside>
      )}
      <main className="main" id="main">
        {children}
      </main>
      {!desktop && (
        <>
          <div className="fab-wrap">
            <Button
              className="fab"
              aria-label="Внести данные"
              data-testid="add-entry"
              icon={
                <span className="fab-icon">
                  <Icon name="plus" size={20} strokeWidth={2.4} />
                </span>
              }
              onClick={() => openEntry()}
            >
              {loc.pathname === '/' ? 'Внести данные' : undefined}
            </Button>
          </div>
          <nav className="tabbar-wrap" aria-label="Основная навигация">
            <TabBar
              className="tabbar"
              value={tabValue}
              onValueChange={(v) => nav(v)}
              items={[
                ...mobileItems.map((n) => ({ value: n.to, label: n.label, icon: <Icon name={n.icon} size={22} /> })),
                { value: '/more', label: 'Ещё', icon: <Icon name="more" size={22} /> },
              ]}
            />
          </nav>
        </>
      )}
    </div>
  );
}

/** Page header: title + optional actions; on phones it respects the notch / Dynamic Island. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle && <p className="muted small page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
