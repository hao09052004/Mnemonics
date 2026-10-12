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
import { ApiClient, type Session, type AnalyticsOverviewResponse, type AnalyticsCapturesResponse } from '../lib/api-client';

interface Props { api: ApiClient }

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem('mnemonics:session');
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN');
}

export function AnalyticsPage({ api }: Props) {
  const [overview, setOverview] = useState<AnalyticsOverviewResponse['data'] | null>(null);
  const [series, setSeries] = useState<AnalyticsCapturesResponse['data']['series']>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Phân tích — Mnemonics';
    const session = loadSession();
    if (!session?.accessToken) {
      setError('Vui lòng đăng nhập để xem phân tích.');
      return;
    }
    (async () => {
      try {
        const [o, c] = await Promise.all([
          api.getAnalyticsOverview(session.accessToken, 30),
          api.getAnalyticsCaptures(session.accessToken, 30)
        ]);
        setOverview(o.data);
        setSeries(c.data.series);
      } catch (e: any) {
        setError(e?.message || 'Không thể tải phân tích');
      }
    })();
  }, [api]);

  if (error) return <p className="admin-empty">{error}</p>;
  if (!overview) return <p className="admin-empty">Đang tải phân tích…</p>;

  const max = Math.max(1, ...series.map((s) => s.count));

  return (
    <div className="analytics-page">
      <h1>Phân tích của bạn</h1>
      <p className="analytics-page-subtitle">
        Tổng quan 30 ngày gần nhất. Số liệu từ cơ sở dữ liệu, không phải mẫu.
      </p>

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
          <li><span>Gói</span><strong>{overview.plan.planId}</strong></li>
          <li><span>Semantic search</span><strong>{overview.plan.semanticSearchEnabled ? 'Bật' : 'Tắt'}</strong></li>
          <li>
            <span>Hết hạn</span>
            <strong>{formatDate(overview.plan.validUntil)}</strong>
          </li>
          <li>
            <span>Giới hạn tháng</span>
            <strong>
              {overview.plan.monthlyCaptureLimit === null ? 'Không giới hạn' : overview.plan.monthlyCaptureLimit}
            </strong>
          </li>
        </ul>
      </section>
    </div>
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
