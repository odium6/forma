import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Menu, TabBar } from 'glisse';
import { Icon, type IconName } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { useOpenEntry } from '@/features/entry/EntrySheet';
import { saveSettings, useData } from '@/state/store';
import { Sheet } from '@/ui/Sheet';
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
  const [addOpen, setAddOpen] = useState(false);

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
          <button className="btn primary block lg" onClick={() => setAddOpen(true)} data-testid="add-entry">
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
      <AddSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onPick={(focus) => {
          setAddOpen(false);
          openEntry({ focus });
        }}
      />
    </div>
  );
}

const ADD_ACTIONS: { focus: 'weight' | 'measurements' | 'note'; icon: IconName; title: string; sub: string; testId: string }[] = [
  { focus: 'weight', icon: 'scale', title: 'Вес', sub: 'Утреннее взвешивание', testId: 'add-weight' },
  { focus: 'measurements', icon: 'ruler', title: 'Параметры тела', sub: 'Обхваты и процент жира', testId: 'add-body' },
  { focus: 'note', icon: 'note', title: 'Заметка', sub: 'Сон, самочувствие, тренировка', testId: 'add-note' },
];

function AddSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (f: 'weight' | 'measurements' | 'note') => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Внести данные" size="sm">
      <div className="list add-actions">
        {ADD_ACTIONS.map((a) => (
          <button key={a.focus} className="list-item" onClick={() => onPick(a.focus)} data-testid={a.testId}>
            <span className="list-icon tint"><Icon name={a.icon} size={19} /></span>
            <span className="list-text">
              <span className="list-title">{a.title}</span>
              <span className="list-sub">{a.sub}</span>
            </span>
            <Icon name="right" size={18} className="chev" />
          </button>
        ))}
      </div>
    </Sheet>
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
