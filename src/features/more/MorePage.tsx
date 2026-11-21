import { Link } from 'react-router';
import { PageHeader, ThemeMenu } from '@/app/Layout';
import { useData } from '@/state/store';
import { Icon, type IconName } from '@/ui/Icon';
import { plural } from '@/lib/format';

const GROUPS: { title: string; items: { to: string; label: string; icon: IconName; sub: string }[] }[] = [
  { title: 'Активность', items: [{ to: '/calendar', label: 'Календарь', icon: 'calendar', sub: 'Измерения, фото и привычки по дням' }] },
  { title: 'Мотивация', items: [{ to: '/achievements', label: 'Достижения', icon: 'trophy', sub: '' }] },
  { title: 'Аналитика', items: [{ to: '/reports', label: 'Отчёты', icon: 'report', sub: 'PDF, CSV и JSON за любой период' }] },
  { title: 'Приложение', items: [{ to: '/settings', label: 'Настройки', icon: 'settings', sub: 'Профиль, уведомления, защита, данные' }] },
];

/** Mobile "More" tab: secondary sections that don't fit in the tab bar. */
export default function MorePage() {
  const data = useData();
  const n = data.achievements.length;
  const subs: Record<string, string> = { '/achievements': n ? `Получено ${n} ${plural(n, ['достижение', 'достижения', 'достижений'])}` : 'Пока ничего — всё впереди' };
  return (
    <div className="page">
      <PageHeader title="Ещё" actions={<ThemeMenu />} />
      {GROUPS.map((g) => (
        <section key={g.title} className="section">
          <h2 className="group-title">{g.title}</h2>
          <div className="group">
            {g.items.map((it) => (
              <Link key={it.to} to={it.to} className="list-item">
                <span className="list-icon tint"><Icon name={it.icon} size={18} /></span>
                <span className="list-text">
                  <span className="list-title">{it.label}</span>
                  <span className="list-sub">{subs[it.to] ?? it.sub}</span>
                </span>
                <Icon name="right" size={16} className="chev" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
