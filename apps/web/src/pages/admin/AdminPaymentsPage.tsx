/**
 * Admin payments page (M4).
 *
 * Lists payment orders with status, amount, reference, and
 * supports manual reconciliation (admin.payments.review).
 */
import { useEffect, useState } from 'react';
import { ApiClient, type Session, type AdminOrderRow, type AdminPaymentsResponse, loadStoredSession } from '../../lib/api-client';

interface Props { api: ApiClient }

function loadSession(): Session | null {
  return loadStoredSession();
}

const STATUS_OPTIONS = ['', 'pending', 'paid', 'expired', 'cancelled', 'rejected', 'refunded'];

function formatVnd(n: string | number): string {
  return new Intl.NumberFormat('vi-VN').format(Number(n)) + ' VND';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN');
}

function statusPill(status: string) {
  if (status === 'paid') return <span className="admin-pill admin-pill--paid">{status}</span>;
  if (status === 'pending') return <span className="admin-pill admin-pill--pending">{status}</span>;
  return <span className="admin-pill">{status}</span>;
}

export function AdminPaymentsPage({ api }: Props) {
  const [items, setItems] = useState<AdminOrderRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (s: string) => {
    setLoading(true);
    const session = loadSession();
    if (!session?.accessToken) {
      setError('Phiên đăng nhập đã hết hạn.');
      setLoading(false);
      return;
    }
    try {
      const r = await api.adminListPayments(session.accessToken, { status: s || undefined, limit: 100 });
      setItems(r.data.items);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Không thể tải đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
  }, [api]);

  const onReconcile = async (order: AdminOrderRow) => {
    const session = loadSession();
    if (!session?.accessToken) return;
    const note = window.prompt(
      `Đối soát đơn ${order.reference} (${formatVnd(order.amount_vnd)}). Nhập ghi chú xác nhận:`,
      'admin reconciliation'
    );
    if (!note) return;
    setBusyId(order.id);
    try {
      await api.adminReconcilePayment(
        order.id,
        Number(order.amount_vnd),
        note,
        session.accessToken
      );
      await load(status);
    } catch (e: any) {
      window.alert(e?.message || 'Không thể đối soát');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 className="admin-page-title">Đơn hàng</h1>
      <p className="admin-page-subtitle">Đối soát thủ công các giao dịch chưa được webhook xác nhận.</p>
      <form className="admin-toolbar" onSubmit={(e) => { e.preventDefault(); void load(status); }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s || 'all'} value={s}>{s || 'Tất cả'}</option>
          ))}
        </select>
        <button className="admin-button" type="submit">Lọc</button>
      </form>
      {error && <p className="admin-empty">{error}</p>}
      {loading ? (
        <p className="admin-empty">Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">Chưa có đơn hàng nào.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>User</th>
              <th>Gói</th>
              <th>Số tiền</th>
              <th>Tham chiếu</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
              <th>Thanh toán</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>{o.user_email ?? '—'}</td>
                <td>
                  {o.plan_id}
                  <br />
                  <small style={{ color: '#888' }}>{o.interval}</small>
                </td>
                <td>{formatVnd(o.amount_vnd)}</td>
                <td><code>{o.reference}</code></td>
                <td>{statusPill(o.status)}</td>
                <td>{formatDate(o.created_at)}</td>
                <td>{formatDate(o.paid_at)}</td>
                <td>
                  {o.status === 'pending' && (
                    <button
                      type="button"
                      className="admin-button"
                      disabled={busyId === o.id}
                      onClick={() => onReconcile(o)}
                    >
                      Đối soát
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
