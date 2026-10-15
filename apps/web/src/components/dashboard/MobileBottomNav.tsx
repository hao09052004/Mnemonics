import { Icon, type IconName } from './Icons';
import type { DashboardPage } from './DashboardTopNav';
import { useLocale } from '../../lib/locale';

interface MobileBottomNavProps {
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
}

const ITEMS: Array<{ label: DashboardPage; icon: IconName; key: string }> = [
  { label: 'Everything', icon: 'grid', key: 'nav_everything' },
  { label: 'Favorites', icon: 'heart', key: 'nav_favorites' },
  { label: 'Spaces', icon: 'layers', key: 'nav_spaces' },
  { label: 'Rediscover', icon: 'sparkle', key: 'nav_rediscover' },
  { label: 'Settings', icon: 'settings', key: 'nav_mobile_settings' },
];

export function MobileBottomNav({ active, onNavigate, onCapture }: MobileBottomNavProps) {
  const { t } = useLocale();

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
          <small>{t(item.key, item.label)}</small>
        </button>
      ))}
      <button type="button" onClick={onCapture} aria-label="Capture memory">
        <span className="capture-mobile"><Icon name="plus" /></span>
        <small>{t('nav_mobile_capture', 'Capture')}</small>
      </button>
    </nav>
  );
}