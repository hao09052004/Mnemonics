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
    <div style={{ maxWidth: 420, margin: '0 auto', color: '#ffffff' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', marginBottom: 12, color: '#ffffff', letterSpacing: '-0.4px' }}>
        Quên mật khẩu
      </h1>

      {sent ? (
        <div
          role="status"
          data-testid="forgot-sent"
          style={{
            padding: '16px 18px',
            background: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            borderRadius: 12,
            color: '#6ee7b7',
            fontSize: 13.5,
            lineHeight: 1.6,
            textAlign: 'center'
          }}
        >
          Nếu email tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu.
          Hãy kiểm tra hộp thư (kể cả thư mục spam).
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 13.5, color: 'rgba(255, 255, 255, 0.65)', margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
            Nhập email của bạn. Nếu tài khoản tồn tại, bạn sẽ nhận được liên kết để đặt lại mật khẩu.
          </p>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.4)', pointerEvents: 'none', display: 'flex' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              data-testid="forgot-email"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px 12px 38px',
                background: 'rgba(255, 255, 255, 0.045)',
                border: '1px solid rgba(255, 255, 255, 0.11)',
                borderRadius: 12,
                color: '#ffffff',
                fontSize: 14.5,
                outline: 'none'
              }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            data-testid="forgot-submit"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '13px 20px',
              background: 'linear-gradient(135deg, #7457e8 0%, #5b3fe4 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 18px rgba(116, 87, 232, 0.38)',
              opacity: submitting ? 0.6 : 1
            }}
          >
            {submitting ? 'Đang gửi...' : 'Gửi liên kết đặt lại'}
          </button>
        </form>
      )}

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a78bfa',
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 500,
            transition: 'color 0.15s ease'
          }}
        >
          ← Quay lại đăng nhập
        </button>
      </div>
    </div>
  );
}
