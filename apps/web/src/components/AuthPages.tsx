/**
 * Auth Pages Component
 *
 * Combined login / register / forgot-password / reset-password surface for
 * the web dashboard.
 *
 * - `login` and `register` modes are the legacy auth flow (handled
 *   inline; same UX as the previous `LoginForm`).
 * - `forgot` lets the user request a recovery email. The server always
 *   returns 200, so we display a neutral "check your inbox" message.
 * - `reset` is reached when the URL contains both `access_token` and
 *   `refresh_token` in the hash fragment (the recovery link Supabase
 *   generates). The user only has to type the new password; tokens are
 *   never user-editable.
 *
 * After a successful reset we hand the freshly minted session back to
 * `onLogin` so the user lands in the dashboard without typing the
 * password again.
 */

import { useEffect, useState } from 'react';
import { ApiClient, ApiError, type Session } from '../lib/api-client';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

interface AuthPagesProps {
  api: ApiClient;
  onLogin: (session: Session) => void;
}

interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

function readRecoveryTokens(): RecoveryTokens | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function AuthPages({ api, onLogin }: AuthPagesProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  // Detect the Supabase recovery-link redirect and auto-switch into reset mode.
  useEffect(() => {
    if (readRecoveryTokens()) setMode('reset');
  }, []);

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

  const handleLoginOrRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    reset();
    try {
      const result = mode === 'login'
        ? await api.login({ email, password })
        : await api.register({ email, password, name: name || undefined });

      if (result.session) {
        onLogin(result.session);
        return;
      }
      if (mode === 'register') {
        setInfo('Đăng ký thành công. Hãy kiểm tra email để xác minh tài khoản rồi đăng nhập.');
      } else {
        setError('Không nhận được phiên đăng nhập. Hãy thử lại.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setInfo('Tài khoản chưa xác minh email. Hãy mở hộp thư và xác nhận trước khi đăng nhập.');
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    reset();
    try {
      await api.forgotPassword(email);
      setInfo('Nếu email tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi yêu cầu');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tokens = readRecoveryTokens();
    if (!tokens) {
      setError('Liên kết đặt lại không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
      return;
    }
    setLoading(true);
    reset();
    try {
      const result = await api.resetPassword({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        newPassword
      });
      if (result.session) {
        // Strip the hash so a refresh doesn't try to reset again.
        window.history.replaceState(null, '', window.location.pathname);
        onLogin(result.session);
        return;
      }
      setError('Không nhận được phiên đăng nhập sau khi đặt lại. Hãy thử đăng nhập.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu');
    } finally {
      setLoading(false);
    }
  };

  const heading = {
    login: 'Đăng nhập',
    register: 'Đăng ký',
    forgot: 'Quên mật khẩu',
    reset: 'Đặt lại mật khẩu'
  }[mode];

  return (
    <div style={{ maxWidth: 400, margin: '64px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 32 }}>
        Mnemonics
      </h1>

      <h2 style={{ fontSize: 18, marginBottom: 16, textAlign: 'center' }}>{heading}</h2>

      {mode === 'forgot' && (
        <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Nhập email đã đăng ký. Nếu email tồn tại, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            data-testid="forgot-email"
            style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
          />
          <Banner kind="info" message={info} testid="forgot-info" />
          <Banner kind="error" message={error} />
          <button
            type="submit"
            disabled={loading}
            data-testid="forgot-submit"
            style={primaryButtonStyle(loading)}
          >
            {loading ? 'Đang gửi...' : 'Gửi liên kết đặt lại'}
          </button>
          <button type="button" onClick={() => { reset(); setMode('login'); }} style={linkButtonStyle}>
            ← Quay lại đăng nhập
          </button>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Đặt mật khẩu mới cho tài khoản của bạn. Sau khi đặt xong bạn sẽ được đăng nhập tự động.
          </p>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mật khẩu mới (≥10 ký tự, có chữ hoa, thường, số, ký tự đặc biệt)"
            required
            minLength={10}
            data-testid="reset-password"
            style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
          />
          <Banner kind="error" message={error} />
          <button
            type="submit"
            disabled={loading}
            data-testid="reset-submit"
            style={primaryButtonStyle(loading)}
          >
            {loading ? 'Đang đặt lại...' : 'Đặt mật khẩu'}
          </button>
        </form>
      )}

      {(mode === 'login' || mode === 'register') && (
        <form onSubmit={handleLoginOrRegister} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên (tùy chọn)"
              style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            data-testid="auth-email"
            style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu"
            required
            minLength={10}
            data-testid="auth-password"
            style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
          />
          <Banner kind="info" message={info} testid="auth-info" />
          <Banner kind="error" message={error} />
          {demoMode && (
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={loading}
              data-testid="demo-login-btn"
              style={{
                padding: '10px 16px',
                background: '#0f172a',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 700
              }}
            >
              ⚡ Đăng nhập Demo
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            data-testid="auth-submit"
            style={primaryButtonStyle(loading)}
          >
            {loading ? 'Đang xử lý...' : heading}
          </button>
          <button
            type="button"
            onClick={() => { reset(); setMode(mode === 'login' ? 'register' : 'login'); }}
            data-testid="toggle-mode"
            style={linkButtonStyle}
          >
            {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
          </button>
          {mode === 'login' && (
            <button
              type="button"
              onClick={() => { reset(); setMode('forgot'); }}
              data-testid="go-forgot"
              style={{ ...linkButtonStyle, fontSize: 13 }}
            >
              Quên mật khẩu?
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function Banner({ kind, message, testid }: { kind: 'info' | 'error'; message: string | null; testid?: string }) {
  if (!message) return null;
  const palette = kind === 'info'
    ? { bg: '#ecfdf5', border: '#6ee7b7', color: '#047857' }
    : { bg: '#fee', border: '#fcc', color: '#dc2626' };
  const role = kind === 'info' ? 'status' : 'alert';
  return (
    <div
      role={role}
      data-testid={testid}
      style={{ padding: 12, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 8, color: palette.color, fontSize: 13 }}
    >
      {message}
    </div>
  );
}

function primaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: '12px 16px',
    background: loading ? '#ccc' : '#4f46e5',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    cursor: loading ? 'not-allowed' : 'pointer',
    fontSize: 16,
    fontWeight: 600
  };
}

const linkButtonStyle: React.CSSProperties = {
  padding: '8px',
  background: 'transparent',
  border: 'none',
  color: '#4f46e5',
  cursor: 'pointer',
  fontSize: 14
};