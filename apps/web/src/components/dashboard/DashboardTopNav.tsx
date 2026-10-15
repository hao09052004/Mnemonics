import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icons';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../lib/api-client';
import { useTheme } from '../../lib/theme';
import { useLocale } from '../../lib/locale';
import { ThemeSwitch } from '../common/ThemeSwitch';
import { LanguageSwitch } from '../common/LanguageSwitch';

export type DashboardPage =
  | 'Everything'
  | 'Favorites'
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
  { label: 'Favorites' },
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
  const { mode, resolved } = useTheme();
  const { locale, t } = useLocale();

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
          <span className="brand-tagline">{t('brand_tagline', 'Save once — Find anytime.')}</span>
        </span>
      </button>

      <nav aria-label="Main navigation">
        {NAV.map((item) => {
          const map: Record<string, string> = {
            Everything: t('nav_everything', 'Everything'),
            Favorites: t('nav_favorites', 'Favorites'),
            Groups: t('nav_groups', 'Groups'),
            Spaces: t('nav_spaces', 'Spaces'),
            Rediscover: t('nav_rediscover', 'Rediscover'),
            Reminders: t('nav_reminders', 'Reminders'),
          };
          const displayLabel = map[item.label] ?? item.label;
          return (
            <button
              key={item.label}
              type="button"
              className={active === item.label ? 'header-link active' : 'header-link'}
              aria-current={active === item.label ? 'page' : undefined}
              onClick={() => onNavigate(item.label)}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              {displayLabel}
            </button>
          );
        })}
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
          {t('nav_analytics', 'Analytics')}
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
          {t('nav_account', 'Account')}
        </button>
        {isAdmin && (
          <button
            type="button"
            className="header-link"
            onClick={() => navigate('/admin')}
            data-testid="nav-admin"
            title={t('nav_admin', 'Quản trị')}
          >
            {t('nav_admin', 'Admin')}
          </button>
        )}
      </nav>

      <div className="header-actions">
        <ThemeSwitch />
        <LanguageSwitch compact />
        <button
          type="button"
          className="primary"
          onClick={onCapture}
          data-testid="capture-btn"
        >
          <Icon name="plus" size={16} />
          {t('btn_capture', 'Capture')}
        </button>
        <div className="header-account-wrapper" ref={menuRef}>
          <button
            type="button"
            className={accountMenuOpen ? 'avatar active' : 'avatar'}
            title={
              user?.email
                ? `${user.email} (${locale === 'vi' ? 'Bấm để xem menu tài khoản' : 'Click to view account menu'})`
                : `${t('account_default_name', 'Account')} · ${initials}`
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
                    {user?.name || user?.email?.split('@')[0] || t('account_default_name', 'Account')}
                  </div>
                  <div className="account-dropdown-email" title={user?.email}>
                    {user?.email || t('account_unknown_email', 'Unknown')}
                  </div>
                  <div className="account-dropdown-badge">
                    {isAdmin ? (
                      <span className="admin-badge">Admin</span>
                    ) : (
                      <span className="user-badge">{t('badge_active', 'Active')}</span>
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
                  <span>{t('menu_account_plans', 'Account & Plans')}</span>
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
                  <span>{t('menu_analytics', 'Analytics & Stats')}</span>
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
                    <span>{t('menu_admin', 'System Administration (Admin)')}</span>
                  </button>
                )}
              </div>

              <div className="account-dropdown-divider" />

              <div style={{ padding: '8px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}>
                    {t('lang_label_theme', 'Giao diện')}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--purple-text)' }}>
                    {mode === 'system'
                      ? `${t('theme_system', 'Hệ thống')} (${resolved === 'dark' ? t('theme_dark', 'Tối') : t('theme_light', 'Sáng')})`
                      : mode === 'dark'
                        ? t('theme_dark', 'Tối')
                        : t('theme_light', 'Sáng')}
                  </span>
                </div>
                <ThemeSwitch style={{ width: '100%', justifyContent: 'space-between' }} />
              </div>

              <div className="account-dropdown-divider" />

              <div style={{ padding: '8px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}>
                    {t('lang_label_language', 'Ngôn ngữ')}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--purple-text)' }}>
                    {locale === 'vi' ? 'Tiếng Việt' : 'English'}
                  </span>
                </div>
                <LanguageSwitch style={{ width: '100%', justifyContent: 'space-between' }} />
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
                    <span>{t('btn_logout', 'Đăng xuất')}</span>
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

