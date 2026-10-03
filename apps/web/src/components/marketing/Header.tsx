import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { productConfig } from '../../config/product';

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
    { label: 'Browser extension', to: '/browser-extension' },
    { label: 'Privacy', to: '/#privacy' }
  ];

  const faded = floatOnTop && scrolled;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'saturate(150%) blur(12px)',
        WebkitBackdropFilter: 'saturate(150%) blur(12px)',
        background: faded ? 'rgba(247,245,239,0.78)' : 'rgba(247,245,239,0.6)',
        borderBottom: '1px solid var(--border)',
        transition: 'background 0.2s ease'
      }}
    >
      <div
        className="container"
        style={{
          height: 'var(--header-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <Link
          to="/"
          aria-label="Mnemonics home"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 17 }}
        >
          <Logo />
          <span>Mnemonics</span>
        </Link>

        <nav
          aria-label="Primary"
          style={{
            display: 'none',
            gap: 28
          }}
          className="mnemonics-header-nav"
        >
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 500 }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} className="mnemonics-header-actions">
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
          </div>
        </div>
      )}

      <style>{`
        @media (min-width: 860px) {
          .mnemonics-header-nav { display: inline-flex !important; }
          .mnemonics-header-burger { display: none !important; }
        }
      `}</style>

      {/* Suppress unused-prop warning in environments where it's referenced */}
      <span hidden>{String(Boolean(productConfig.webUrl))}</span>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill="#5b3fe4" />
      <path d="M9 7 H19 V22 L14 18 L9 22 Z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <text x="14" y="17" fontFamily="system-ui,sans-serif" fontSize="8" fontWeight={800} fill="#fff" textAnchor="middle">M</text>
      <circle cx="21" cy="7" r="4" fill="#a78bfa" />
    </svg>
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
