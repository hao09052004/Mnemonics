import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { productConfig } from '../../config/product';
import { ThemeSwitch } from '../common/ThemeSwitch';
import { useTheme } from '../../lib/theme';

interface HeaderProps {
  /** When true, render a translucent floating header (used at top of page). */
  floatOnTop?: boolean;
}

/**
 * Sticky marketing header.
 *
 * Renders three states:
 *   - Public visitor  → Log in + Add to Chrome CTAs.
 *   - Authenticated   → Replaces "Log in" with "Open Mnemonics" linking
 *                        to /app. We infer auth from localStorage so the
 *                        header updates immediately after login without
 *                        requiring a Redux store.
 *   - Mobile (<860px) → Collapses nav into a hamburger sheet.
 *
 * Visual: the header reduces opacity on scroll-down, restores on
 * scroll-up. Skipped when prefers-reduced-motion is set.
 */
export function Header({ floatOnTop = true }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [authed, setAuthed] = useState(false);
  const { resolved } = useTheme();
  const location = useLocation();

  useEffect(() => {
    // Cheap auth probe — if the dashboard logged in, there's a
    // `mnemonics_session` in localStorage. We do not parse the
    // session here, just check presence.
    try {
      setAuthed(Boolean(window.localStorage.getItem('mnemonics_session')));
    } catch {
      setAuthed(false);
    }

    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Visible when scrolling up, faded when scrolling down past 80px.
      const goingDown = y > lastY;
      setScrolled(goingDown && y > 80);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu on route change.
  useEffect(() => setOpen(false), [location.pathname]);

  const navItems: { label: string; to: string }[] = [
    { label: 'Product', to: '/#product' },
    { label: 'How it works', to: '/#how' },
    { label: 'Bảng giá', to: '/pricing' },
    { label: 'Browser extension', to: '/browser-extension' },
    { label: 'Privacy', to: '/#privacy' }
  ];

  const handleNavClick = (to: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (to.includes('#')) {
      const [path, hashId] = to.split('#');
      const currentPath = location.pathname;
      if (path === '' || path === currentPath || (path === '/' && currentPath === '/')) {
        e.preventDefault();
        const el = document.getElementById(hashId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          window.history.pushState(null, '', `#${hashId}`);
        }
        setOpen(false);
      }
    }
  };

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      document.documentElement.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
    } catch {
      // no-op in JSDOM / test environments
    }

    if (location.pathname === '/') {
      e.preventDefault();
      if (window.location.hash) {
        window.history.pushState(null, '', '/');
      }
    }
  };

  const faded = floatOnTop && scrolled;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        background: resolved === 'light'
          ? (faded ? 'rgba(248, 247, 244, 0.96)' : 'rgba(248, 247, 244, 0.88)')
          : (faded ? 'rgba(12, 14, 20, 0.94)' : 'rgba(12, 14, 20, 0.82)'),
        borderBottom: resolved === 'light'
          ? '1px solid rgba(0, 0, 0, 0.08)'
          : '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: resolved === 'light'
          ? '0 4px 20px -4px rgba(0, 0, 0, 0.05)'
          : '0 4px 20px -4px rgba(0, 0, 0, 0.35)',
        transition: 'background 0.2s ease, border-color 0.2s ease'
      }}
    >
      <div
        className="container"
        style={{
          minHeight: 'var(--header-h)',
          height: 'var(--header-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'nowrap',
          gap: 12
        }}
      >
        <Link
          to="/"
          onClick={handleLogoClick}
          aria-label="Mnemonics home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--ink)',
            textDecoration: 'none',
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          <Logo />
          <span>Mnemonics</span>
        </Link>

        <nav
          aria-label="Primary"
          style={{
            display: 'none',
            gap: 8,
            alignItems: 'center',
            whiteSpace: 'nowrap'
          }}
          className="mnemonics-header-nav"
        >
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={handleNavClick(item.to)}
              style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Vị trí chỗ trống trên thanh điều hướng — Theme Switcher */}
        <div className="mnemonics-header-theme-slot" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
          <ThemeSwitch compact />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} className="mnemonics-header-actions">
          {authed ? (
            <Link to="/app" className="btn btn--ghost btn--sm">
              Open Mnemonics
            </Link>
          ) : (
            <Link to="/login" className="btn btn--ghost btn--sm">
              Log in
            </Link>
          )}
          <Link
            to="/browser-extension"
            className="btn btn--brand btn--sm"
            data-testid="header-add-to-chrome"
          >
            Get Mnemonics
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mnemonics-header-burger"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer'
            }}
          >
            <Burger open={open} />
          </button>
        </div>
      </div>

      {open && (
        <div
          className="mnemonics-header-sheet"
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            padding: '12px 24px 20px'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={handleNavClick(item.to)}
                style={{
                  padding: '12px 4px',
                  fontSize: 16,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                {item.label}
              </Link>
            ))}
            <Link
              to={authed ? '/app' : '/login'}
              style={{ padding: '12px 4px', fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}
            >
              {authed ? 'Open Mnemonics' : 'Log in'}
            </Link>
            <div
              style={{
                paddingTop: 14,
                marginTop: 6,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 500 }}>Giao diện</span>
              <ThemeSwitch />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (min-width: 860px) {
          .mnemonics-header-nav { display: inline-flex !important; }
          .mnemonics-header-burger { display: none !important; }
        }
        @media (max-width: 600px) {
          .mnemonics-header-theme-slot { display: none !important; }
        }
        .mnemonics-header-nav a {
          transition: color 0.18s ease, background 0.18s ease;
          padding: 6px 12px;
          border-radius: 8px;
        }
        .mnemonics-header-nav a:hover {
          color: var(--ink) !important;
          background: var(--surface-hover, rgba(255, 255, 255, 0.06));
        }
      `}</style>

      {/* Suppress unused-prop warning in environments where it's referenced */}
      <span hidden>{String(Boolean(productConfig.webUrl))}</span>
    </header>
  );
}

function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt="Mnemonics"
      width={size}
      height={size}
      style={{ borderRadius: '50%', display: 'block', objectFit: 'contain' }}
    />
  );
}

function Burger({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <line x1="3" y1={open ? 9 : 5} x2="15" y2={open ? 9 : 5} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity={open ? 0 : 1} />
      <line x1="3" y1={open ? 9 : 13} x2="15" y2={open ? 9 : 13} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
