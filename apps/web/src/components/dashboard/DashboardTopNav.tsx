import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icons';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../lib/api-client';

export type DashboardPage =
  | 'Everything'
  | 'Groups'
  | 'Spaces'
  | 'Rediscover'
  | 'Reminders'
  | 'Settings'
  | 'Phân tích'
  | 'Tài khoản'
  | 'Billing'
  | 'Analytics';

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
  onLogout?: () => void;
}

export function DashboardTopNav({
  active,
  onNavigate,
  onCapture,
  initials,
  user,
  isAdmin,
  onLogout,
}: DashboardTopNavProps) {
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [accountMenuOpen]);

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
        onClick={() => {
          onNavigate('Everything');
          try {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            document.documentElement.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
          } catch {
            // no-op in JSDOM / test environments
          }
        }}
        aria-label="Mnemonics home"
        data-testid="brand"
      >
        <span className="brand-symbol" style={{ padding: 0, overflow: 'hidden', background: 'transparent', boxShadow: 'none' }}>
          <img src="/logo.png" alt="m" width={36} height={36} style={{ borderRadius: '50%', display: 'block', objectFit: 'contain' }} />
        </span>
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
          className={
            active === 'Phân tích' || active === 'Analytics'
              ? 'header-link active'
              : 'header-link'
          }
          onClick={() => navigate('/app/analytics')}
          data-testid="nav-analytics"
        >
          Phân tích
        </button>
        <button
          type="button"
          className={
            active === 'Tài khoản' || active === 'Billing' || active === 'Settings'
              ? 'header-link active'
              : 'header-link'
          }
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
          title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
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
        <div className="header-account-wrapper" ref={menuRef}>
          <button
            type="button"
            className={accountMenuOpen ? 'avatar active' : 'avatar'}
            title={
              user?.email
                ? `${user.email} (Bấm để xem menu tài khoản)`
                : `Tài khoản · ${initials}`
            }
            aria-label="Account menu"
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            onClick={() => setAccountMenuOpen((prev) => !prev)}
            data-testid="avatar-btn"
          >
            {initials}
          </button>

          {accountMenuOpen && (
            <div className="account-dropdown-menu" role="menu" data-testid="account-dropdown">
              <div className="account-dropdown-header">
                <div className="account-dropdown-avatar">{initials}</div>
                <div className="account-dropdown-info">
                  <div className="account-dropdown-name">
                    {user?.name || user?.email?.split('@')[0] || 'Tài khoản'}
                  </div>
                  <div className="account-dropdown-email" title={user?.email}>
                    {user?.email || 'Chưa xác định'}
                  </div>
                  <div className="account-dropdown-badge">
                    {isAdmin ? (
                      <span className="admin-badge">Admin</span>
                    ) : (
                      <span className="user-badge">Đang hoạt động</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="account-dropdown-divider" />

              <div className="account-dropdown-items">
                <button
                  type="button"
                  className="account-dropdown-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    navigate('/app/billing');
                  }}
                  data-testid="dropdown-nav-billing"
                >
                  <Icon name="settings" size={15} />
                  <span>Tài khoản & Gói cước</span>
                </button>
                <button
                  type="button"
                  className="account-dropdown-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    navigate('/app/analytics');
                  }}
                  data-testid="dropdown-nav-analytics"
                >
                  <Icon name="sliders" size={15} />
                  <span>Thống kê phân tích</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="account-dropdown-item"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      navigate('/admin');
                    }}
                    data-testid="dropdown-nav-admin"
                  >
                    <Icon name="layers" size={15} />
                    <span>Quản trị hệ thống (Admin)</span>
                  </button>
                )}
              </div>

              {onLogout && (
                <>
                  <div className="account-dropdown-divider" />
                  <button
                    type="button"
                    className="account-dropdown-item account-dropdown-logout"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onLogout();
                    }}
                    data-testid="dropdown-logout"
                  >
                    <Icon name="x" size={15} />
                    <span>Đăng xuất</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

