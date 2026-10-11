/**
 * Account billing view (M2/M3).
 *
 * Shows:
 *   - Current plan
 *   - Mastery expiry
 *   - Pending / paid order history
 *   - Renewal CTA
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, type Session, type Entitlement, type OrderRecord } from '../lib/api-client';

interface Props { api: ApiClient }

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem('mnemonics:session');
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function formatVnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n) + ' VND';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN');
}

export function BillingPage({ api }: Props) {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Tài khoản — Mnemonics';
    const session = loadSession();
    if (!session?.accessToken) {
      setError('Vui lòng đăng nhập.');
      return;
    }
    (async () => {
      try {
        const [e, o] = await Promise.all([
          api.getMyEntitlement(session.accessToken),
          api.listMyOrders(session.accessToken)
        ]);
        setEntitlement(e.data.entitlement);
        setOrders(o.data.items);
      } catch (err: any) {
        setError(err?.message || 'Không thể tải tài khoản');
      }
    })();
  }, [api]);

  if (error) return <p style={{ padding: '1.5rem' }}>{error}</p>;
  if (!entitlement) return <p style={{ padding: '1.5rem' }}>Đang tải…</p>;

  return (
    <div className="billing-page" style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1>Tài khoản của bạn</h1>

      <section className="admin-card">
        <h2>Gói hiện tại</h2>
        <ul className="analytics-list">
          <li><span>Gói</span><strong>{entitlement.planId}</strong></li>
          <li><span>Semantic search</span><strong>{entitlement.semanticSearchEnabled ? 'Bật' : 'Tắt'}</strong></li>
          <li><span>Hết hạn</span><strong>{formatDate(entitlement.validUntil)}</strong></li>
          <li>
            <span>Giới hạn tháng</span>
            <strong>
              {entitlement.monthlyCaptureLimit === null ? 'Không giới hạn' : entitlement.monthlyCaptureLimit}
            </strong>
          </li>
        </ul>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/pricing" className="admin-button">Nâng cấp Mastery</Link>
        </p>
      </section>

      <section className="admin-card">
        <h2>Đơn hàng gần đây</h2>
        {orders.length === 0 ? (
          <p>Bạn chưa có đơn hàng nào.</p>
        ) : (
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
                  <td>{o.planId}</td>
                  <td>{formatVnd(o.amountVnd)}</td>
                  <td>{o.status}</td>
                  <td><code>{o.reference}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
