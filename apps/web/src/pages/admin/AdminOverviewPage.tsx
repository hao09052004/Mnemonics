/**
 * Admin overview page (M5).
 *
 * Top-line KPIs from the verified backend:
 *   - users (total, today, 30d, by plan)
 *   - revenue (verified, refunded, pending, paid30d)
 *   - product (total captures, 30d, success rate, semantic usage)
 *
 * Numbers are real database metrics. No mock values.
 */
import { useEffect, useState } from 'react';
import { ApiClient, type Session, type AdminOverviewResponse } from '../../lib/api-client';

interface Props { api: ApiClient }

function formatVnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n) + ' VND';
}
function formatPct(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return (n * 100).toFixed(1) + '%';
}

export function AdminOverviewPage({ api }: Props) {
  const [data, setData] = useState<AdminOverviewResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = api.loadStoredSession();
    if (!session?.accessToken) return;
    (async () => {
      try {
        const r = await api.adminAnalyticsOverview(session.accessToken);
        setData(r.data);
      } catch (e: any) {
        setError(e?.message || 'Không thể tải tổng quan');
      }
    })();
  }, [api]);

  if (error) return <p className="admin-empty">{error}</p>;
  if (!data) return <p className="admin-empty">Đang tải tổng quan…</p>;

  return (
    <>
      <h1 className="admin-page-title">Tổng quan</h1>
      <p className="admin-page-subtitle">Số liệu thật từ cơ sở dữ liệu — không phải số liệu mẫu.</p>
      <section className="admin-grid">
        <Kpi label="Tổng người dùng" value={data.users.total} foot={`+${data.users.newToday} hôm nay`} />
        <Kpi label="Đăng ký mới (30d)" value={data.users.new30d} />
        <Kpi label="Memory (miễn phí)" value={data.users.memoryPlan} />
        <Kpi label="Mastery (trả phí)" value={data.users.masteryPlan} />
      </section>
      <section className="admin-grid">
        <Kpi label="Doanh thu đã xác minh" value={formatVnd(data.revenue.verifiedVnd)} foot={`${data.revenue.verifiedOrders} đơn paid`} />
        <Kpi label="Đang chờ thanh toán" value={formatVnd(data.revenue.pendingVnd)} />
        <Kpi label="Đã hoàn" value={formatVnd(data.revenue.refundedVnd)} />
        <Kpi label="Doanh thu 30 ngày" value={formatVnd(data.revenue.paid30dVnd)} />
      </section>
      <section className="admin-grid">
        <Kpi label="Tổng memory" value={data.product.totalCaptures} foot={`+${data.product.captures30d} trong 30 ngày`} />
        <Kpi label="Tỉ lệ thành công" value={formatPct(data.product.successRate)} />
        <Kpi label="Semantic search 30d" value={data.product.semanticSearch30d} />
      </section>
    </>
  );
}

function Kpi({ label, value, foot }: { label: string; value: string | number; foot?: string }) {
  return (
    <div className="admin-kpi">
      <p className="admin-kpi-label">{label}</p>
      <p className="admin-kpi-value">{value}</p>
      {foot && <p className="admin-kpi-foot">{foot}</p>}
    </div>
  );
}
