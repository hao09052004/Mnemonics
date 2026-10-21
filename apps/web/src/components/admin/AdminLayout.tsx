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

const SECTIONS: Array<{ to: string; label: string; icon: string; perm: string }> = [
  { to: '/admin', label: 'Tổng quan', icon: '📊', perm: 'admin.analytics.read' },
  { to: '/admin/funnel', label: 'Chỉ số Marketing', icon: '📈', perm: 'admin.analytics.read' },
  { to: '/admin/users', label: 'Người dùng & Duyệt gói', icon: '👥', perm: 'admin.users.read' },
  { to: '/admin/payments', label: 'Đơn hàng', icon: '💳', perm: 'admin.payments.read' },
  { to: '/admin/audit-logs', label: 'Nhật ký', icon: '📜', perm: 'admin.audit.read' }
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
        const user = (me.data as any).user;
        const perms: string[] = user?.permissions ?? [];
        const isAdmin = user?.role === 'admin' || perms.some((p: string) => p.startsWith('admin.'));
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #7c5cfc, #6366f1)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: '1rem',
              color: '#ffffff'
            }}
          >
            M
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Mnemonics Admin
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === '/admin'}
              className={({ isActive }) => (isActive ? 'is-active' : undefined)}
            >
              <span style={{ fontSize: '1.05rem' }}>{s.icon}</span>
              <span>{s.label}</span>
            </NavLink>
          ))}
        </div>

        <NavLink to="/app" className="admin-button--secondary" style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
          ← Về Dashboard
        </NavLink>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
