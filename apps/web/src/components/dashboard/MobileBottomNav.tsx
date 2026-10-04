import { Icon, type IconName } from './Icons';
import type { DashboardPage } from './DashboardTopNav';

interface MobileBottomNavProps {
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
}

const ITEMS: Array<{ label: DashboardPage; icon: IconName }> = [
  { label: 'Everything', icon: 'grid' },
  { label: 'Spaces', icon: 'layers' },
  { label: 'Rediscover', icon: 'sparkle' },
  { label: 'Settings', icon: 'settings' },
];

export function MobileBottomNav({ active, onNavigate, onCapture }: MobileBottomNavProps) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          className={active === item.label ? 'active' : ''}
          onClick={() => onNavigate(item.label)}
        >
          <span><Icon name={item.icon} /></span>
          <small>{item.label}</small>
        </button>
      ))}
      <button type="button" onClick={onCapture} aria-label="Capture memory">
        <span className="capture-mobile"><Icon name="plus" /></span>
        <small>Capture</small>
      </button>
    </nav>
  );
}