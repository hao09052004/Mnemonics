/**
 * Admin dashboard layout (M4).
 *
 * Wraps every /admin/* route with a sidebar (Overview, Users,
 * Revenue, Subscriptions, Payments, Product, AI Usage,
 * System Health, Audit Logs) and a main content area. The
 * sidebar hides on mobile and collapses into a horizontal
 * scroller. Only callers with at least one admin.* permission
 * are allowed past the page guard.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ApiClient, type Session } from '../../lib/api-client';

interface AdminLayoutProps {
  api: ApiClient;
  children: ReactNode;
}

const SECTIONS: Array<{ to: string; label: string; perm: string }> = [
  { to: '/admin', label: 'Tổng quan', perm: 'admin.analytics.read' },
  { to: '/admin/users', label: 'Người dùng', perm: 'admin.users.read' },
  { to: '/admin/payments', label: 'Đơn hàng', perm: 'admin.payments.read' },
  { to: '/admin/audit-logs', label: 'Nhật ký', perm: 'admin.audit.read' }
];

export function AdminLayout({ api, children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Quản trị — Mnemonics';
    const session = api.loadStoredSession();
    if (!session?.accessToken) {
      navigate('/login?next=/admin');
      return;
    }
    (async () => {
      try {
        const me = await api.me(session.accessToken);
        const perms: string[] = (me.data as any).user?.permissions ?? [];
        const isAdmin = perms.some((p) => p.startsWith('admin.'));
        if (!isAdmin) {
          setError('Bạn không có quyền truy cập khu vực quản trị.');
          setTimeout(() => navigate('/app'), 1500);
          return;
        }
        setReady(true);
      } catch (e) {
        setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        setTimeout(() => navigate('/login'), 1500);
      }
    })();
  }, [api, navigate]);

  if (error) {
    return (
      <div className="admin-shell">
        <main className="admin-main" style={{ gridColumn: '1 / -1' }}>
          <p className="admin-empty">{error}</p>
        </main>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="admin-shell">
        <main className="admin-main" style={{ gridColumn: '1 / -1' }}>
          <p className="admin-empty">Đang tải khu vực quản trị…</p>
        </main>
      </div>
    );
  }
  return (
    <div className="admin-shell">
      <nav className="admin-sidebar">
        <h1 className="admin-sidebar-title">Admin</h1>
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.to === '/admin'}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            {s.label}
          </NavLink>
        ))}
        <NavLink to="/app" className="admin-button--secondary" style={{ marginTop: '1rem' }}>
          ← Về dashboard
        </NavLink>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
