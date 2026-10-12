/**
 * Checkout page (M3) — displays the dynamic VietQR.
 *
 * Flow:
 *   1. User clicks "Upgrade" on /pricing with plan=mastery-monthly
 *      or plan=mastery-yearly in the query string.
 *   2. This page creates a pending order via the API.
 *   3. The QR (as a data URL) + amount + transfer reference
 *      are rendered. The user pays from their banking app.
 *   4. The user can click "I've paid" to poll for status
 *      (the page auto-polls every 5s once an order is pending).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClient, type Session, type OrderRecord } from '../lib/api-client';

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

export function BillingCheckoutPage({ api }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId = params.get('plan') === 'mastery-yearly' ? 'mastery-yearly' : 'mastery-monthly';
  const session = loadSession();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<{ bank: string; bin: string; account: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!session?.accessToken) {
      navigate('/login?next=' + encodeURIComponent(`/app/billing/checkout?plan=${planId}`));
    }
  }, [session, navigate, planId]);

  useEffect(() => {
    document.title = 'Thanh toán Mastery — Mnemonics';
  }, []);

  const createOrder = useCallback(async () => {
    if (!session?.accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.createOrder(planId, session.accessToken);
      setOrder(r.data.order);
      setQrDataUrl(r.data.qr.dataUrl);
      setRecipient(r.data.recipient);
    } catch (e: any) {
      setError(e?.message || 'Không thể tạo đơn hàng');
    } finally {
      setSubmitting(false);
    }
  }, [api, planId, session]);

  useEffect(() => {
    void createOrder();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [createOrder]);

  // Auto-poll the order status while it's pending.
  useEffect(() => {
    if (!order || !session?.accessToken) return;
    if (order.status !== 'pending') return;
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await api.getMyOrder(order.id, session.accessToken);
        setOrder(r.data.order);
        if (r.data.order.status !== 'pending' && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {/* swallow — try again next tick */}
    }, 5000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, order, session]);

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

  if (!session) return null;

  return (
    <div className="billing-page" style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1>Thanh toán Mastery</h1>
      <p style={{ color: '#666' }}>
        Quét mã QR bằng ứng dụng ngân hàng hoặc chuyển khoản thủ công với nội dung bên dưới.
      </p>
      {error && (
        <p style={{ color: '#b22', background: '#ffe9e9', padding: '0.75rem', borderRadius: 8 }}>
          {error}
        </p>
      )}
      {submitting && <p>Đang tạo đơn hàng…</p>}
      {order && (
        <>
          <div className="admin-card" style={{ textAlign: 'center' }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="VietQR"
                width={280}
                height={280}
                style={{ borderRadius: 12, border: '1px solid #eee' }}
              />
            ) : (
              <p>Đang tải QR…</p>
            )}
            <p style={{ marginTop: '1rem' }}>
              <strong>{planId === 'mastery-yearly' ? 'Mastery (Năm)' : 'Mastery (Tháng)'}</strong>
              <br />
              <span style={{ fontSize: '1.4rem', fontWeight: 700, color: '#6c47ff' }}>
                {formatVnd(order.amountVnd)}
              </span>
            </p>
            <p>
              Trạng thái:&nbsp;
              <strong>{order.status}</strong>
            </p>
            {order.status === 'paid' && (
              <p style={{ color: '#1c7a35', fontWeight: 600 }}>
                ✓ Thanh toán thành công! Mastery đã được kích hoạt.
              </p>
            )}
          </div>

          <div className="admin-card">
            <h2>Thông tin chuyển khoản</h2>
            {recipient && (
              <ul className="analytics-list">
                <li><span>Ngân hàng</span><strong>{recipient.bank}</strong></li>
                <li><span>BIN</span><strong>{recipient.bin}</strong></li>
                <li>
                  <span>Số tài khoản</span>
                  <strong>
                    {recipient.account}{' '}
                    <button type="button" className="admin-button admin-button--secondary" onClick={() => copy(recipient.account)}>
                      Sao chép
                    </button>
                  </strong>
                </li>
              </ul>
            )}
            <p>
              <strong>Nội dung chuyển khoản (bắt buộc):</strong>{' '}
              <code style={{ background: '#f0f0f0', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                {order.reference}
              </code>{' '}
              <button type="button" className="admin-button admin-button--secondary" onClick={() => copy(order.reference)}>
                {copied ? 'Đã sao chép' : 'Sao chép'}
              </button>
            </p>
            <p style={{ color: '#888', fontSize: '0.85rem' }}>
              Hệ thống sẽ tự động xác nhận khoản chuyển qua Vietcombank. Nếu sau 5 phút vẫn chưa kích hoạt, vui lòng liên hệ hỗ trợ kèm mã đơn hàng.
            </p>
            {order.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => void createOrder()}
                >
                  Tạo lại mã
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={onCancel}
                >
                  Hủy đơn
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <p style={{ marginTop: '1.5rem' }}>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/app/billing')}>
          ← Quay lại tài khoản
        </button>
      </p>
    </div>
  );
}
