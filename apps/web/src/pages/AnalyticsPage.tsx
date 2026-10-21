/**
 * Personal analytics page (M5).
 *
 * - Total memories
 * - This-month count + remaining captures (Memory only)
 * - Trend over the last 30 days
 * - Memories by type
 * - Plan info
 * - Spaces + distinct tags
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiClient,
  type Session,
  type AnalyticsOverviewResponse,
  type AnalyticsCapturesResponse,
} from '../lib/api-client';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import type { DashboardPage } from '../components/dashboard/DashboardTopNav';
import { MarketingFunnelAnalytics } from '../components/analytics/MarketingFunnelAnalytics';

interface Props {
  api: ApiClient;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN');
}

export function AnalyticsPage({ api }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') === 'funnel' ? 'funnel' : 'overview';

  const [session, setSession] = useState<Session | null>(() => api.loadStoredSession());
  const [overview, setOverview] = useState<AnalyticsOverviewResponse['data'] | null>(null);
  const [series, setSeries] = useState<AnalyticsCapturesResponse['data']['series']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = currentTab === 'funnel' ? 'Chỉ số Funnel & Marketing — Mnemonics' : 'Phân tích — Mnemonics';
    const s = api.loadStoredSession();
    setSession(s);
    if (!s?.accessToken) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const [o, c] = await Promise.all([
          api.getAnalyticsOverview(s.accessToken, 30),
          api.getAnalyticsCaptures(s.accessToken, 30),
        ]);
        setOverview(o.data);
        setSeries(c.data.series);
      } catch (e: any) {
        setError(e?.message || 'Không thể tải phân tích');
      } finally {
        setLoading(false);
      }
    })();
  }, [api, currentTab]);

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
      <div
        className="analytics-page"
        style={{
          maxWidth: currentTab === 'funnel' ? 1040 : 520,
          margin: '3rem auto',
          padding: '1.5rem',
          transition: 'max-width 0.2s'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: 4,
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              type="button"
              data-testid="unauth-tab-funnel"
              onClick={() => setSearchParams({ tab: 'funnel' })}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: currentTab === 'funnel' ? '#7457e8' : 'transparent',
                color: currentTab === 'funnel' ? '#ffffff' : 'var(--mn-text-2, #a2a9b8)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              Chỉ số Funnel & Marketing
            </button>
            <button
              type="button"
              data-testid="unauth-tab-overview"
              onClick={() => setSearchParams({ tab: 'overview' })}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: currentTab === 'overview' ? '#7457e8' : 'transparent',
                color: currentTab === 'overview' ? '#ffffff' : 'var(--mn-text-2, #a2a9b8)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              Tổng quan bộ nhớ
            </button>
          </div>
        </div>

        {currentTab === 'funnel' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => navigate('/login?next=/app/analytics?tab=funnel')}
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                Đăng nhập tài khoản →
              </button>
            </div>
            <MarketingFunnelAnalytics api={api} />
          </div>
        ) : (
          <div className="admin-card" style={{ padding: '3rem 2rem', borderRadius: 16, textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.6rem', marginBottom: '0.75rem' }}>Chưa đăng nhập</h1>
            <p style={{ color: 'var(--secondary)', marginBottom: '1.75rem', lineHeight: 1.5 }}>
              Vui lòng đăng nhập để xem phân tích và thống kê bộ nhớ của bạn.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                type="button"
                className="admin-button"
                onClick={() => navigate('/login?next=/app/analytics')}
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
        )}
      </div>
    );
  }

  const max = Math.max(1, ...series.map((s) => s.count));

  return (
    <DashboardShell
      user={session.user}
      active="Phân tích"
      onNavigate={handleNavigate}
      onCapture={() => navigate('/app')}
      onLogout={handleLogout}
      demoMode={false}
    >
      <main className="analytics-page">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: '0 0 6px 0' }}>Phân tích & Thống kê</h1>
            <p className="analytics-page-subtitle" style={{ margin: 0 }}>
              {currentTab === 'funnel'
                ? 'Báo cáo phễu chuyển đổi marketing, tỷ lệ dùng thử và đối chiếu KPI thực tế.'
                : `Tổng quan 30 ngày gần nhất. Số liệu từ cơ sở dữ liệu của tài khoản ${session.user.email}.`}
            </p>
          </div>

          <div
            style={{
              display: 'inline-flex',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: 4,
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              type="button"
              data-testid="tab-overview"
              onClick={() => setSearchParams({ tab: 'overview' })}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: currentTab === 'overview' ? '#7457e8' : 'transparent',
                color: currentTab === 'overview' ? '#ffffff' : 'var(--mn-text-2, #a2a9b8)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Tổng quan bộ nhớ
            </button>
            <button
              type="button"
              data-testid="tab-funnel"
              onClick={() => setSearchParams({ tab: 'funnel' })}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: currentTab === 'funnel' ? '#7457e8' : 'transparent',
                color: currentTab === 'funnel' ? '#ffffff' : 'var(--mn-text-2, #a2a9b8)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease'
              }}
            >
              <span>Chỉ số Funnel & Marketing</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: currentTab === 'funnel' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(116, 87, 232, 0.3)',
                  color: '#ffffff',
                  padding: '1px 6px',
                  borderRadius: 10
                }}
              >
                Mới
              </span>
            </button>
          </div>
        </div>

        {currentTab === 'funnel' ? (
          <MarketingFunnelAnalytics api={api} />
        ) : loading ? (
          <p className="admin-empty">Đang tải phân tích…</p>
        ) : error ? (
          <p className="admin-empty">{error}</p>
        ) : overview ? (
          <>
            <section className="analytics-grid">
              <Kpi label="Tổng memory" value={overview.totalCaptures} />
              <Kpi label="Tháng này" value={overview.thisMonth} />
              <Kpi
                label="Còn lại (Memory)"
                value={
                  overview.plan.remainingCaptures === null
                    ? 'Không giới hạn'
                    : overview.plan.remainingCaptures
                }
              />
              <Kpi label="AI calls (30d)" value={overview.aiCallsThisPeriod} />
              <Kpi label="Spaces" value={overview.spaces} />
              <Kpi label="Tags" value={overview.distinctTags} />
            </section>

            <section className="admin-card">
              <h2>Memory theo ngày (30 ngày gần nhất)</h2>
              <div className="analytics-trend" role="img" aria-label="Biểu đồ memory theo ngày">
                {series.map((s) => (
                  <div
                    key={s.day}
                    className="analytics-trend-bar"
                    style={{ height: `${Math.max(2, (s.count / max) * 100)}%` }}
                    title={`${s.day}: ${s.count}`}
                  />
                ))}
              </div>
              {series.every((s) => s.count === 0) && (
                <p className="analytics-empty">Chưa có lượt lưu nào trong 30 ngày qua.</p>
              )}
            </section>

            <section className="admin-card">
              <h2>Phân loại nội dung</h2>
              {overview.byType.length === 0 ? (
                <p className="analytics-empty">Chưa có dữ liệu.</p>
              ) : (
                <ul className="analytics-list">
                  {overview.byType.map((row) => (
                    <li key={row.type}>
                      <span>{row.type}</span>
                      <strong>{row.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="admin-card">
              <h2>Gói hiện tại</h2>
              <ul className="analytics-list">
                <li>
                  <span>Gói</span>
                  <strong>{overview.plan.planId}</strong>
                </li>
                <li>
                  <span>Semantic search</span>
                  <strong>{overview.plan.semanticSearchEnabled ? 'Bật' : 'Tắt'}</strong>
                </li>
                <li>
                  <span>Hết hạn</span>
                  <strong>{formatDate(overview.plan.validUntil)}</strong>
                </li>
                <li>
                  <span>Giới hạn tháng</span>
                  <strong>
                    {overview.plan.monthlyCaptureLimit === null
                      ? 'Không giới hạn'
                      : overview.plan.monthlyCaptureLimit}
                  </strong>
                </li>
              </ul>
            </section>
          </>
        ) : null}
      </main>
    </DashboardShell>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="analytics-card">
      <p className="analytics-card-label">{label}</p>
      <p className="analytics-card-value">{value}</p>
    </div>
  );
}
