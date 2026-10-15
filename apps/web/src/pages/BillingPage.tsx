/**
 * Account & billing view (M2/M3).
 *
 * Shows:
 *   - Account identity (Email, Name, Role, User ID)
 *   - Current plan & entitlement
 *   - Mastery expiry
 *   - VietQR order history
 *   - Logout action
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiClient,
  type Session,
  type Entitlement,
  type OrderRecord,
} from '../lib/api-client';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import type { DashboardPage } from '../components/dashboard/DashboardTopNav';

interface Props {
  api: ApiClient;
}

function formatVnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n) + ' VND';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

function computeInitials(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : email;
  return name.slice(0, 2).toUpperCase();
}

export function BillingPage({ api }: Props) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(() => api.loadStoredSession());
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Tài khoản — Mnemonics';
    const s = api.loadStoredSession();
    setSession(s);
    if (!s?.accessToken) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const [e, o] = await Promise.all([
          api.getMyEntitlement(s.accessToken),
          api.listMyOrders(s.accessToken),
        ]);
        setEntitlement(e.data.entitlement);
        setOrders(o.data.items);
      } catch (err: any) {
        setError(err?.message || 'Không thể tải thông tin tài khoản');
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  const handleLogout = () => {
    api.saveSession(null);
    setSession(null);
    navigate('/login');
  };

  const handleNavigate = (page: DashboardPage) => {
    if (page === 'Everything') navigate('/app');
    else if (page === 'Spaces') navigate('/app/spaces');
    else if (page === 'Rediscover') navigate('/app/rediscover');
    else if (page === 'Reminders') navigate('/app/reminders');
    else if (page === 'Phân tích' || page === 'Analytics') navigate('/app/analytics');
    else if (page === 'Tài khoản' || page === 'Billing') navigate('/app/billing');
  };

  if (!session) {
    return (
      <div className="billing-page" style={{ maxWidth: 520, margin: '5rem auto', padding: '2rem 1.5rem', textAlign: 'center' }}>
        <div className="admin-card" style={{ padding: '3rem 2rem', borderRadius: 16 }}>
          <h1 style={{ fontSize: '1.6rem', marginBottom: '0.75rem' }}>Chưa đăng nhập</h1>
          <p style={{ color: 'var(--secondary)', marginBottom: '1.75rem', lineHeight: 1.5 }}>
            Vui lòng đăng nhập để xem thông tin tài khoản, gói cước và lịch sử đơn hàng.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button
              type="button"
              className="admin-button"
              onClick={() => navigate('/login?next=/app/billing')}
            >
              Đăng nhập ngay
            </button>
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={() => navigate('/')}
            >
              Về trang chủ
            </button>
          </div>
        </div>
      </div>
    );
  }

  const initials = computeInitials(session.user.email);
  const isAdmin = (session.user as any).role === 'admin' || (session.user as any).permissions?.some((p: string) => p.startsWith('admin.'));

  return (
    <DashboardShell
      user={session.user}
      active="Tài khoản"
      onNavigate={handleNavigate}
      onCapture={() => navigate('/app')}
      onLogout={handleLogout}
      demoMode={false}
    >
      <main className="billing-page" style={{ maxWidth: 840, margin: '0 auto', padding: '2rem 1.5rem 5rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 700, margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>
            Tài khoản của bạn
          </h1>
          <p style={{ color: 'var(--secondary)', margin: 0, fontSize: '0.95rem' }}>
            Quản lý thông tin đăng nhập, gói dịch vụ và lịch sử thanh toán VietQR.
          </p>
        </div>

        {/* Thông tin tài khoản */}
        <section className="admin-card account-card">
          <div className="account-card-header">
            <div className="account-card-avatar">{initials}</div>
            <div className="account-card-user">
              <div className="account-card-badge">
                <span className="account-status-dot" />
                <span>Đang đăng nhập</span>
              </div>
              <h2 className="account-card-email" data-testid="account-email">
                {session.user.email}
              </h2>
              <div className="account-card-meta">
                <span>Họ và tên: <strong>{session.user.name || 'Chưa đặt tên'}</strong></span>
                <span>·</span>
                <span>Vai trò: <strong style={{ textTransform: 'capitalize' }}>{session.user.role || (isAdmin ? 'Admin' : 'Thành viên')}</strong></span>
                <span>·</span>
                <span>ID: <code style={{ fontSize: '11px', opacity: 0.8 }}>{session.user.id}</code></span>
              </div>
            </div>
          </div>
          <div className="account-card-actions">
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={handleLogout}
              data-testid="account-logout-btn"
            >
              Đăng xuất tài khoản
            </button>
          </div>
        </section>

        {/* Gói dịch vụ hiện tại */}
        <section className="admin-card">
          <h2>Gói hiện tại</h2>
          {loading ? (
            <p style={{ color: 'var(--secondary)' }}>Đang tải thông tin gói cước…</p>
          ) : entitlement ? (
            <>
              <ul className="analytics-list">
                <li>
                  <span>Gói dịch vụ</span>
                  <strong style={{ textTransform: 'uppercase' }}>{entitlement.planId}</strong>
                </li>
                <li>
                  <span>Toàn bộ tính năng AI của Mnemonics</span>
                  <strong style={{ color: entitlement.semanticSearchEnabled ? 'var(--emerald, #22c55e)' : 'var(--muted)' }}>
                    {entitlement.semanticSearchEnabled ? 'Đã mở khóa toàn bộ' : 'Chưa kích hoạt'}
                  </strong>
                </li>
                <li>
                  <span>Thời hạn hiệu lực</span>
                  <strong>{formatDate(entitlement.validUntil)}</strong>
                </li>
                <li>
                  <span>Giới hạn lưu trữ tháng</span>
                  <strong>
                    {entitlement.monthlyCaptureLimit === null
                      ? 'Không giới hạn'
                      : `${entitlement.monthlyCaptureLimit} memories / tháng`}
                  </strong>
                </li>
              </ul>

              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: entitlement.semanticSearchEnabled
                    ? 'rgba(34, 197, 94, 0.08)'
                    : 'rgba(108, 71, 255, 0.08)',
                  border: entitlement.semanticSearchEnabled
                    ? '1px solid rgba(34, 197, 94, 0.25)'
                    : '1px solid rgba(108, 71, 255, 0.25)',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{entitlement.semanticSearchEnabled ? '✓' : '✨'}</span>
                  <span>
                    {entitlement.semanticSearchEnabled
                      ? 'Gói Mastery: Toàn bộ công nghệ AI đang hoạt động'
                      : 'Gói Mastery mở khóa trọn bộ tính năng AI có của Mnemonics:'}
                  </span>
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.25rem',
                    color: 'var(--secondary)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '4px',
                  }}
                >
                  <li>• <strong>Semantic Search</strong>: Tìm kiếm ngữ nghĩa theo ý hiểu</li>
                  <li>• <strong>AI Summary</strong>: Tóm tắt thông minh TL;DR</li>
                  <li>• <strong>Smart Tags</strong>: Tự động phân tích &amp; gắn thẻ</li>
                  <li>• <strong>AI Groups</strong>: Gom nhóm &amp; phát hiện chủ đề</li>
                  <li>• <strong>Related Memories</strong>: Đề xuất tri thức liên quan</li>
                </ul>
              </div>

              <p style={{ marginTop: '1.25rem', marginBottom: 0 }}>
                <Link to="/pricing" className="admin-button">
                  {entitlement.semanticSearchEnabled ? 'Gia hạn / Đổi gói Mastery' : 'Nâng cấp gói Mastery'}
                </Link>
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--secondary)' }}>{error || 'Không có dữ liệu gói cước.'}</p>
          )}
        </section>

        {/* Đơn hàng gần đây */}
        <section className="admin-card">
          <h2>Lịch sử đơn hàng VietQR</h2>
          {orders.length === 0 ? (
            <p style={{ color: 'var(--secondary)', margin: 0 }}>Bạn chưa có đơn hàng nào.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ngày tạo</th>
                    <th>Gói</th>
                    <th>Số tiền</th>
                    <th>Trạng thái</th>
                    <th>Mã tham chiếu</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>{formatDate(o.createdAt)}</td>
                      <td>
                        <span className="admin-pill admin-pill--mastery">{o.planId}</span>
                      </td>
                      <td>{formatVnd(o.amountVnd)}</td>
                      <td>
                        <span
                          className={
                            o.status === 'paid'
                              ? 'admin-pill admin-pill--paid'
                              : 'admin-pill admin-pill--pending'
                          }
                        >
                          {o.status}
                        </span>
                      </td>
                      <td>
                        <code>{o.reference}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  );
}
