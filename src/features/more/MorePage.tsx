import { Link } from 'react-router';
import { PageHeader, NAV, ThemeMenu } from '@/app/Layout';
import { useData } from '@/state/store';
import { Icon } from '@/ui/Icon';

/** Mobile "More" tab: secondary sections that don't fit in the tab bar. */
export default function MorePage() {
  const data = useData();
  const secondary = NAV.filter((n) => !n.mobile);
  const counts: Record<string, string | undefined> = {
    '/achievements': `${data.achievements.length}`,
  };
  return (
    <div className="page">
      <PageHeader title="Ещё" actions={<ThemeMenu />} />
      <section className="card">
        <div className="list">
          {secondary.map((n) => (
            <Link key={n.to} to={n.to} className="list-item" style={{ color: 'inherit' }}>
              <span className="list-icon"><Icon name={n.icon} size={19} /></span>
              <span className="grow strong">{n.label}</span>
              {counts[n.to] && <span className="badge num">{counts[n.to]}</span>}
              <Icon name="right" size={18} className="faint" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
