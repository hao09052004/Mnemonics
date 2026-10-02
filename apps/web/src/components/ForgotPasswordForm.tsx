/**
 * ForgotPasswordForm
 *
 * Single-field form to trigger the forgot-password flow. The backend
 * always returns 200 (anti-enumeration), so we only ever surface a
 * neutral confirmation. If the API rejects the call (e.g. demo mode
 * has no real endpoint), we still show the same confirmation to keep
 * the user from learning whether the email exists.
 */

import { useState } from 'react';
import { ApiClient, ApiError } from '../lib/api-client';

interface ForgotPasswordFormProps {
  api: ApiClient;
  onCancel: () => void;
  onResetRequested?: () => void;
}

export function ForgotPasswordForm({ api, onCancel, onResetRequested }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      // The endpoint always returns 200, so the promise should not normally
      // throw. If it does (e.g. demo mode lacking the route) we still treat
      // it as success for anti-enumeration parity.
      await api.forgotPassword(email.trim()).catch((err: unknown) => {
        if (err instanceof ApiError) {
          // Real failures (4xx validation, 5xx) — surface as info message.
          throw err;
        }
        // Network/unknown — pretend it worked.
        return undefined;
      });
      setSent(true);
      onResetRequested?.();
    } catch (err) {
      setSent(true);
      setEmail('');
      void err;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '64px auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 24 }}>
        Quên mật khẩu
      </h1>

      {sent ? (
        <div
          role="status"
          data-testid="forgot-sent"
          style={{ padding: 16, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 10, color: '#047857', fontSize: 13, lineHeight: 1.5 }}
        >
          Nếu email tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu.
          Hãy kiểm tra hộp thư (kể cả thư mục spam).
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
            Nhập email của bạn. Nếu tài khoản tồn tại, bạn sẽ nhận được liên kết để đặt lại mật khẩu.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            data-testid="forgot-email"
            style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
          <button
            type="submit"
            disabled={submitting}
            data-testid="forgot-submit"
            style={{
              padding: '12px 16px',
              background: submitting ? '#ccc' : '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 15,
              fontWeight: 600
            }}
          >
            {submitting ? 'Đang gửi...' : 'Gửi liên kết đặt lại'}
          </button>
        </form>
      )}

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: 'transparent', border: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: 13 }}
        >
          ← Quay lại đăng nhập
        </button>
      </div>
    </div>
  );
}
