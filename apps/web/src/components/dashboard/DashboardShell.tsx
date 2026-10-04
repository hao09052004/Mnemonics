import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '../../lib/api-client';
import { DashboardTopNav, type DashboardPage } from './DashboardTopNav';
import { MobileBottomNav } from './MobileBottomNav';

interface DashboardShellProps {
  user: AuthUser;
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
  onLogout: () => void;
  demoMode?: boolean;
  children: ReactNode;
}

/**
 * Top-nav shell for the authenticated dashboard.
 *
 * Layout (desktop):
 *   ┌──────────────────────────────────────────────┐
 *   │  brand  · nav links · capture · avatar       │
 *   ├──────────────────────────────────────────────┤
 *   │  children: page content (masonry etc.)       │
 *   └──────────────────────────────────────────────┘
 *
 * Layout (mobile, ≤ 760px):
 *   - top bar collapses
 *   - bottom nav with capture CTA
 *
 * The shell does NOT own the search / filter / grid — those live in
 * the page. Keeping the shell a layout-only component keeps the routes
 * drop-in compatible.
 */
export function DashboardShell({
  user,
  active,
  onNavigate,
  onCapture,
  onLogout,
  demoMode,
  children,
}: DashboardShellProps) {
  // Cmd/Ctrl + K focuses the dashboard search input if present.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const hotkey = isMac ? e.metaKey : e.ctrlKey;
      if (!hotkey || e.key.toLowerCase() !== 'k') return;
      const el = document.querySelector<HTMLInputElement>('[data-mn-search]');
      if (el) {
        e.preventDefault();
        el.focus();
        el.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // onLogout / demoMode are read by pages that pass them down; keeping
  // them on the shell contract for now prevents breaking callers.
  void onLogout;
  void demoMode;
  const initials = computeInitials(user.email);

  return (
    <div className="app">
      <div className="content">
        <DashboardTopNav
          active={active}
          onNavigate={onNavigate}
          onCapture={onCapture}
          initials={initials}
        />
        {children}
      </div>
      <MobileBottomNav active={active} onNavigate={onNavigate} onCapture={onCapture} />
    </div>
  );
}

function computeInitials(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : email;
  return name.slice(0, 2).toUpperCase();
}