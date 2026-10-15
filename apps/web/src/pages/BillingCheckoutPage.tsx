/**
 * Checkout page (M3) — displays the dynamic VietQR.
 *
 * Flow:
 *   1. User clicks "Upgrade" on /pricing with plan=mastery-monthly
 *      or plan=mastery-yearly in the query string.
 *   2. This page creates a pending order via the API once.
 *   3. The QR (as a data URL) + amount + transfer reference
 *      are rendered. The user pays from their banking app.
 *   4. Auto-polls order status every 5s while pending.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiClient,
  type Session,
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

export function BillingCheckoutPage({ api }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId =
    params.get('plan') === 'mastery-yearly' ? 'mastery-yearly' : 'mastery-monthly';

  const [session, setSession] = useState<Session | null>(() => api.loadStoredSession());
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<{
    bank: string;
    bin: string;
    account: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const createdRef = useRef(false);

  useEffect(() => {
    document.title = 'Thanh toán Mastery — Mnemonics';
    const s = api.loadStoredSession();
    setSession(s);
  }, [api]);

  const doCreateOrder = async () => {
    if (!session?.accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.createOrder(planId, session.accessToken);
      setOrder(r.data.order);
      setQrDataUrl(r.data.qr.dataUrl);
      setRecipient(r.data.recipient);
    } catch (e: any) {
      const msg = e?.message || '';
      if (
        msg.includes('503') ||
        msg.includes('Service Unavailable') ||
        e?.status === 503
      ) {
        setError(
          'Máy chủ Render đang thức giấc từ chế độ nghỉ (503 Service Unavailable). Quá trình này mất khoảng 20-40 giây trên gói miễn phí, vui lòng nhấn "Thử lại".'
        );
      } else {
        setError(msg || 'Không thể tạo đơn hàng.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Run order creation ONCE on load
  useEffect(() => {
    if (!session?.accessToken) return;
    if (createdRef.current) return;
    createdRef.current = true;
    void doCreateOrder();
  }, [session?.accessToken]);

  // Auto-poll the order status while it's pending.
  useEffect(() => {
    const orderId = order?.id;
    const token = session?.accessToken;
    if (!orderId || !token || order?.status !== 'pending') return;

    const interval = window.setInterval(async () => {
      try {
        const r = await api.getMyOrder(orderId, token);
        setOrder(r.data.order);
      } catch {
        // intermittent network blip — try again next tick
      }
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [api, order?.id, order?.status, session?.accessToken]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const onCancel = async () => {
    if (!order || !session?.accessToken) return;
    if (!window.confirm('Hủy đơn hàng này?')) return;
    try {
      const r = await api.cancelMyOrder(order.id, session.accessToken);
      setOrder(r.data.order);
    } catch (e: any) {
      window.alert(e?.message || 'Không thể hủy');
    }
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
        className="billing-page"
        style={{
          maxWidth: 520,
          margin: '5rem auto',
          padding: '2rem 1.5rem',
          textAlign: 'center',
        }}
      >
        <div className="admin-card" style={{ padding: '3rem 2rem', borderRadius: 16 }}>
          <h1 style={{ fontSize: '1.6rem', marginBottom: '0.75rem' }}>Chưa đăng nhập</h1>
          <p
            style={{
              color: 'var(--secondary)',
              marginBottom: '1.75rem',
              lineHeight: 1.5,
            }}
          >
            Vui lòng đăng nhập để tiến hành thanh toán gói cước.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button
              type="button"
              className="admin-button"
              onClick={() =>
                navigate(
                  '/login?next=' +
                    encodeURIComponent(`/app/billing/checkout?plan=${planId}`)
                )
              }
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

  return (
    <DashboardShell
      user={session.user}
      active="Tài khoản"
      onNavigate={handleNavigate}
      onCapture={() => navigate('/app')}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/login');
      }}
      demoMode={false}
    >
      <main
        className="billing-page"
        style={{ maxWidth: 740, margin: '0 auto', padding: '2rem 1.5rem 5rem' }}
      >
        <div style={{ marginBottom: '1.75rem' }}>
          <h1
            style={{
              fontSize: '1.85rem',
              fontWeight: 700,
              margin: '0 0 0.5rem',
              letterSpacing: '-0.02em',
            }}
          >
            Thanh toán Mastery
          </h1>
          <p style={{ color: 'var(--secondary)', margin: 0 }}>
            Quét mã QR bằng ứng dụng ngân hàng hoặc chuyển khoản thủ công với nội dung
            bên dưới.
          </p>
        </div>

        {error && (
          <div
            style={{
              color: '#ef4444',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '1.25rem',
              borderRadius: 14,
              marginBottom: '1.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 240 }}>
              <strong style={{ fontSize: '1rem' }}>Không thể kết nối máy chủ</strong>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '0.88rem',
                  lineHeight: 1.45,
                  color: 'inherit',
                  opacity: 0.95,
                }}
              >
                {error}
              </p>
            </div>
            <button
              type="button"
              className="admin-button"
              onClick={() => void doCreateOrder()}
              disabled={submitting}
              style={{ whiteSpace: 'nowrap' }}
            >
              {submitting ? 'Đang thử lại…' : 'Thử lại ngay'}
            </button>
          </div>
        )}

        {submitting && !order && (
          <div
            className="admin-card"
            style={{ textAlign: 'center', padding: '3rem 1.5rem' }}
          >
            <p style={{ color: 'var(--secondary)', margin: 0 }}>
              Đang kết nối tới máy chủ thanh toán…
            </p>
          </div>
        )}

        {order && (
          <>
            <div className="admin-card" style={{ textAlign: 'center', padding: '2rem' }}>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="VietQR"
                  width={280}
                  height={280}
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    margin: '0 auto',
                    display: 'block',
                    background: '#ffffff',
                    padding: '8px',
                  }}
                />
              ) : (
                <p style={{ color: 'var(--secondary)' }}>Đang tạo mã QR VietQR…</p>
              )}
              <p style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '1.1rem' }}>
                  {planId === 'mastery-yearly'
                    ? 'Gói Mastery (1 Năm)'
                    : 'Gói Mastery (1 Tháng)'}
                </strong>
                <br />
                <span
                  style={{
                    fontSize: '1.6rem',
                    fontWeight: 700,
                    color: 'var(--purple-button, #6c47ff)',
                  }}
                >
                  {formatVnd(order.amountVnd)}
                </span>
              </p>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>
                Trạng thái đơn hàng:&nbsp;
                <span
                  className={
                    order.status === 'paid'
                      ? 'admin-pill admin-pill--paid'
                      : 'admin-pill admin-pill--pending'
                  }
                >
                  {order.status === 'paid' ? 'Đã thanh toán' : 'Chờ chuyển khoản'}
                </span>
              </p>
              {order.status === 'paid' && (
                <p
                  style={{
                    color: '#22c55e',
                    fontWeight: 600,
                    marginTop: '1rem',
                    fontSize: '1.05rem',
                  }}
                >
                  ✓ Thanh toán thành công! Gói Mastery đã được kích hoạt trên tài khoản
                  của bạn.
                </p>
              )}
            </div>

            <div className="admin-card">
              <h2>Thông tin chuyển khoản ngân hàng</h2>
              {recipient && (
                <ul className="analytics-list">
                  <li>
                    <span>Ngân hàng thụ hưởng</span>
                    <strong>{recipient.bank}</strong>
                  </li>
                  <li>
                    <span>Mã BIN</span>
                    <strong>{recipient.bin}</strong>
                  </li>
                  <li>
                    <span>Số tài khoản</span>
                    <strong
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      {recipient.account}
                      <button
                        type="button"
                        className="admin-button admin-button--secondary"
                        onClick={() => copy(recipient.account)}
                        style={{ padding: '0.2rem 0.6rem', fontSize: '12px' }}
                      >
                        Sao chép
                      </button>
                    </strong>
                  </li>
                </ul>
              )}
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--elevated)',
                  borderRadius: 10,
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <strong>Nội dung chuyển khoản (bắt buộc):</strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <code
                    style={{
                      background: 'var(--surface)',
                      padding: '0.35rem 0.65rem',
                      borderRadius: 6,
                      fontSize: '1rem',
                      fontWeight: 600,
                      border: '1px solid var(--border)',
                    }}
                  >
                    {order.reference}
                  </code>
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    onClick={() => copy(order.reference)}
                  >
                    {copied ? 'Đã sao chép ✓' : 'Sao chép nội dung'}
                  </button>
                </div>
              </div>
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: '0.85rem',
                  marginTop: '1rem',
                  lineHeight: 1.5,
                }}
              >
                Hệ thống tự động xác nhận giao dịch qua VietQR. Sau khi chuyển khoản
                thành công, trang này sẽ tự động cập nhật trong vòng vài giây.
              </p>
              {order.status === 'pending' && (
                <div style={{ display: 'flex', gap: 10, marginTop: '1.25rem' }}>
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    onClick={() => void doCreateOrder()}
                  >
                    Tạo lại mã thanh toán
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    onClick={onCancel}
                  >
                    Hủy đơn hàng
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <p style={{ marginTop: '1.5rem' }}>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={() => navigate('/app/billing')}
          >
            ← Quay lại trang Tài khoản
          </button>
        </p>
      </main>
    </DashboardShell>
  );
}
