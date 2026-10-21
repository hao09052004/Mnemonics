/**
 * LoginForm Component
 *
 * Talks to the API through `ApiClient` and surfaces the difference
 * between "login failed", "registered but email verification required"
 * and "registered and logged in" — only the last two paths should yield
 * a usable dashboard session.
 */

import { useState } from 'react';
import { ApiClient, ApiError, type Session } from '../lib/api-client';

type Mode = 'login' | 'register';

interface LoginFormProps {
  api: ApiClient;
  onLogin: (session: Session) => void;
  onForgotPassword?: () => void;
  /**
   * When true, the form skips its internal "switch to register/login"
   * toggle. The auth shell (AuthLayout) already provides its own
   * cross-link to /login or /signup, so showing the in-form toggle
   * would be visual duplication.
   */
  hideModeSwitch?: boolean;
  /**
   * Forces the form to render in a specific mode. When provided, the
   * mode toggle is disabled even if hideModeSwitch is not set.
   */
  initialMode?: Mode;
}

export function LoginForm({ api, onLogin, onForgotPassword, hideModeSwitch, initialMode }: LoginFormProps) {
  const [mode, setMode] = useState<Mode>(initialMode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const reset = () => {
    setError(null);
    setInfo(null);
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    reset();
    try {
      const result = await api.login({
        email: 'demo@mnemonics.local',
        password: 'DemoPass123!'
      });
      if (!result.session) {
        setError('Demo account did not return a session.');
        return;
      }
      onLogin(result.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  const reqLength = password.length >= 10;
  const reqLower = /[a-z]/.test(password);
  const reqUpper = /[A-Z]/.test(password);
  const reqDigit = /\d/.test(password);
  const reqSymbol = /[^A-Za-z0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    reset();

    if (mode === 'register') {
      if (!reqLength) {
        setError('Mật khẩu phải có ít nhất 10 ký tự');
        setLoading(false);
        return;
      }
      if (!reqLower) {
        setError('Mật khẩu phải chứa ít nhất một chữ thường (a-z)');
        setLoading(false);
        return;
      }
      if (!reqUpper) {
        setError('Mật khẩu phải chứa ít nhất một chữ in hoa (A-Z)');
        setLoading(false);
        return;
      }
      if (!reqDigit) {
        setError('Mật khẩu phải chứa ít nhất một chữ số (0-9)');
        setLoading(false);
        return;
      }
      if (!reqSymbol) {
        setError('Mật khẩu phải chứa ít nhất một ký tự đặc biệt (!@#$%...)');
        setLoading(false);
        return;
      }
    }

    try {
      const result = mode === 'login'
        ? await api.login({ email, password })
        : await api.register({ email, password, name: name || undefined });

      if (result.session) {
        onLogin(result.session);
        return;
      }

      // No session but a user object → signup successful, awaiting email
      // verification. Treat this as informational, not as a login error.
      if (mode === 'register') {
        setInfo('Đăng ký thành công. Hãy kiểm tra email để xác minh tài khoản rồi đăng nhập.');
      } else {
        setError('Không nhận được phiên đăng nhập. Hãy thử lại.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setInfo('Tài khoản chưa xác minh email. Hãy mở hộp thư và xác nhận trước khi đăng nhập.');
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', color: '#ffffff' }}>
      {/* Brand mark & title for standalone mode */}
      {!hideModeSwitch && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24, textAlign: 'center' }}>
          <div style={{
            width: 54,
            height: 54,
            borderRadius: '50%',
            padding: 3,
            background: 'linear-gradient(135deg, rgba(116, 87, 232, 0.45), rgba(91, 63, 228, 0.15))',
            boxShadow: '0 0 24px -2px rgba(116, 87, 232, 0.4)',
            display: 'grid',
            placeItems: 'center',
            marginBottom: 12
          }}>
            <img src="/logo.png" alt="Mnemonics" width={46} height={46} style={{ borderRadius: '50%', display: 'block' }} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.5px' }}>
            Mnemonics
          </h1>
          <h2 style={{ fontSize: 15, margin: '4px 0 0', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 400 }}>
            {mode === 'login' ? 'Đăng nhập vào tài khoản của bạn' : 'Tạo tài khoản mới'}
          </h2>
        </div>
      )}

      {/* When inside AuthLayout shell, show a subtle centered glowing emblem */}
      {hideModeSwitch && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            padding: 2.5,
            background: 'linear-gradient(135deg, rgba(116, 87, 232, 0.5), rgba(91, 63, 228, 0.15))',
            boxShadow: '0 0 26px -2px rgba(116, 87, 232, 0.45)',
            display: 'grid',
            placeItems: 'center'
          }}>
            <img src="/logo.png" alt="Mnemonics" width={45} height={45} style={{ borderRadius: '50%', display: 'block' }} />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {mode === 'register' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '0.2px' }}>
              Tên hiển thị
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.4)', pointerEvents: 'none', display: 'flex' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tên (tùy chọn)"
                className="mnemonics-input"
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '0.2px' }}>
            Email
          </label>
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
              className="mnemonics-input"
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '0.2px' }}>
              Mật khẩu
            </label>
            {onForgotPassword && (
              <button
                type="button"
                data-testid="forgot-password-link"
                onClick={onForgotPassword}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#a78bfa',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'color 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#c4b5fd')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#a78bfa')}
              >
                Quên mật khẩu?
              </button>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.4)', pointerEvents: 'none', display: 'flex' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu"
              required
              minLength={10}
              className="mnemonics-input"
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 4
              }}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-.722-3.25" />
                  <path d="M2 8a10.645 10.645 0 0 0 20 0" />
                  <path d="m20 15-1.726-2.05" />
                  <path d="m4 15 1.726-2.05" />
                  <path d="m9 18 .722-3.25" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {mode === 'register' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.035)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12,
                marginTop: 2
              }}
            >
              <span style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.75)', marginBottom: 2 }}>
                Yêu cầu mật khẩu an toàn:
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                <span style={{ color: reqLength ? '#34d399' : 'rgba(255, 255, 255, 0.45)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
                  <span style={{ fontWeight: 700 }}>{reqLength ? '✓' : '○'}</span> Tối thiểu 10 ký tự
                </span>
                <span style={{ color: reqLower ? '#34d399' : 'rgba(255, 255, 255, 0.45)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
                  <span style={{ fontWeight: 700 }}>{reqLower ? '✓' : '○'}</span> Chữ thường (a-z)
                </span>
                <span style={{ color: reqUpper ? '#34d399' : 'rgba(255, 255, 255, 0.45)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
                  <span style={{ fontWeight: 700 }}>{reqUpper ? '✓' : '○'}</span> Chữ in hoa (A-Z)
                </span>
                <span style={{ color: reqDigit ? '#34d399' : 'rgba(255, 255, 255, 0.45)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
                  <span style={{ fontWeight: 700 }}>{reqDigit ? '✓' : '○'}</span> Chữ số (0-9)
                </span>
                <span style={{ color: reqSymbol ? '#34d399' : 'rgba(255, 255, 255, 0.45)', display: 'flex', alignItems: 'center', gap: 6, gridColumn: 'span 2', transition: 'color 0.2s' }}>
                  <span style={{ fontWeight: 700 }}>{reqSymbol ? '✓' : '○'}</span> Ký tự đặc biệt (ví dụ: !@#$%^&*)
                </span>
              </div>
            </div>
          )}
        </div>

        {info && (
          <div
            role="status"
            data-testid="login-info"
            style={{
              padding: '12px 14px',
              background: 'rgba(52, 211, 153, 0.12)',
              border: '1px solid rgba(52, 211, 153, 0.3)',
              borderRadius: 10,
              color: '#6ee7b7',
              fontSize: 13,
              lineHeight: 1.5,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start'
            }}
          >
            <span>✓</span>
            <span>{info}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 14px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 10,
              color: '#fca5a5',
              fontSize: 13,
              lineHeight: 1.5,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start'
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mnemonics-primary-btn"
        >
          {loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="spin">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              Đang xử lý...
            </span>
          ) : (
            mode === 'login' ? 'Đăng nhập' : 'Đăng ký'
          )}
        </button>

        {demoMode && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.08)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>hoặc</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.08)' }} />
            </div>

            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={loading}
              data-testid="demo-login-btn"
              className="mnemonics-demo-btn"
            >
              <span>⚡</span>
              <span>Đăng nhập Demo (1-Click)</span>
            </button>
          </>
        )}
      </form>

      {!hideModeSwitch && (
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              reset();
            }}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              color: '#a78bfa',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 500,
              transition: 'color 0.15s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#c4b5fd')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#a78bfa')}
          >
            {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
          </button>
        </div>
      )}

      <style>{`
        .mnemonics-input {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 14px 12px 38px;
          background: rgba(255, 255, 255, 0.045);
          border: 1px solid rgba(255, 255, 255, 0.11);
          border-radius: 12px;
          color: #ffffff;
          font-size: 14.5px;
          outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .mnemonics-input:focus {
          background: rgba(255, 255, 255, 0.07);
          border-color: #7457e8;
          box-shadow: 0 0 0 3px rgba(116, 87, 232, 0.22);
        }
        .mnemonics-input::placeholder {
          color: rgba(255, 255, 255, 0.35);
        }
        .mnemonics-primary-btn {
          width: 100%;
          box-sizing: border-box;
          padding: 13px 20px;
          background: linear-gradient(135deg, #7457e8 0%, #5b3fe4 100%);
          color: #ffffff;
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 18px rgba(116, 87, 232, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.25);
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .mnemonics-primary-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.06);
          box-shadow: 0 6px 22px rgba(116, 87, 232, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .mnemonics-primary-btn:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 2px 10px rgba(116, 87, 232, 0.3);
        }
        .mnemonics-primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          filter: none;
          transform: none;
        }
        .mnemonics-demo-btn {
          width: 100%;
          box-sizing: border-box;
          padding: 11px 18px;
          background: rgba(116, 87, 232, 0.08);
          color: #c4b5fd;
          border: 1px solid rgba(116, 87, 232, 0.28);
          border-radius: 12px;
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
        }
        .mnemonics-demo-btn:hover:not(:disabled) {
          background: rgba(116, 87, 232, 0.16);
          border-color: rgba(116, 87, 232, 0.5);
          color: #ffffff;
          transform: translateY(-1px);
        }
        .mnemonics-demo-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
