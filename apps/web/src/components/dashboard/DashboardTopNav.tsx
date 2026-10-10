import { Icon } from './Icons';

export type DashboardPage =
  | 'Everything'
  | 'Groups'
  | 'Spaces'
  | 'Rediscover'
  | 'Reminders'
  | 'Settings';

const NAV: Array<{ label: DashboardPage }> = [
  { label: 'Everything' },
  { label: 'Groups' },
  { label: 'Spaces' },
  { label: 'Rediscover' },
  { label: 'Reminders' },
];

interface DashboardTopNavProps {
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
  initials: string;
}

export function DashboardTopNav({
  active,
  onNavigate,
  onCapture,
  initials,
}: DashboardTopNavProps) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="brand"
        onClick={() => onNavigate('Everything')}
        aria-label="Mnemonics home"
        data-testid="brand"
      >
        <span className="brand-symbol">m</span>
        <span>
          mnemonics
          <span className="brand-tagline">Save once — Find anytime.</span>
        </span>
      </button>

      <nav aria-label="Main navigation">
        {NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className={active === item.label ? 'header-link active' : 'header-link'}
            aria-current={active === item.label ? 'page' : undefined}
            onClick={() => onNavigate(item.label)}
            data-testid={`nav-${item.label.toLowerCase()}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <button
          type="button"
          className="primary"
          onClick={onCapture}
          data-testid="capture-btn"
        >
          <Icon name="plus" size={16} />
          Capture
        </button>
        <button
          type="button"
          className="avatar"
          title={`Settings · ${initials}`}
          aria-label="Account settings"
          onClick={() => onNavigate('Settings')}
          data-testid="avatar-btn"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}