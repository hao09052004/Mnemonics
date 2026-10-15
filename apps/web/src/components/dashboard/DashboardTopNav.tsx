import { useState, useEffect } from 'react';
import { Icon } from './Icons';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../lib/api-client';

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
  user?: AuthUser;
  isAdmin?: boolean;
}

export function DashboardTopNav({
  active,
  onNavigate,
  onCapture,
  initials,
  isAdmin,
}: DashboardTopNavProps) {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('mnemonics_theme');
      if (stored === 'light' || stored === 'dark') return stored;
    }
    return 'dark';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mnemonics_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      document.body.setAttribute('data-theme', next);
    }
  };

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
        <button
          type="button"
          className="header-link"
          onClick={() => navigate('/app/analytics')}
          data-testid="nav-analytics"
        >
          Phân tích
        </button>
        <button
          type="button"
          className="header-link"
          onClick={() => navigate('/app/billing')}
          data-testid="nav-billing"
        >
          Tài khoản
        </button>
        {isAdmin && (
          <button
            type="button"
            className="header-link"
            onClick={() => navigate('/admin')}
            data-testid="nav-admin"
            title="Khu vực quản trị"
          >
            Admin
          </button>
        )}
      </nav>

      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Warm Paper theme' : 'Switch to Deep Obsidian theme'}
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
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
          title={`Tài khoản · ${initials}`}
          aria-label="Account settings"
          onClick={() => navigate('/app/billing')}
          data-testid="avatar-btn"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
