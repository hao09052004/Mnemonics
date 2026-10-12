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

  const handleSubmit = async (e: React.FormEvent) => {
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
    <div style={{ maxWidth: 400, margin: '24px auto', padding: 12, color: 'var(--ink)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 24, color: 'var(--ink)' }}>
        Mnemonics
      </h1>

      <h2 style={{ fontSize: 18, marginBottom: 16, textAlign: 'center', color: 'var(--ink-soft)' }}>
        {mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
      </h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mode === 'register' && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên (tùy chọn)"
            style={{
              padding: '12px 16px',
              background: 'var(--bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              color: 'var(--ink)',
              fontSize: 14
            }}
          />
        )}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          style={{
            padding: '12px 16px',
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            color: 'var(--ink)',
            fontSize: 14
          }}
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu"
          required
          minLength={10}
          style={{
            padding: '12px 16px',
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            color: 'var(--ink)',
            fontSize: 14
          }}
        />

        {info && (
          <div
            role="status"
            data-testid="login-info"
            style={{
              padding: 12,
              background: 'rgba(52, 211, 153, 0.15)',
              border: '1px solid rgba(52, 211, 153, 0.3)',
              borderRadius: 8,
              color: '#6ee7b7',
              fontSize: 13
            }}
          >
            {info}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: 12,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: 13
            }}
          >
            {error}
          </div>
        )}

        {demoMode && (
          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={loading}
            data-testid="demo-login-btn"
            style={{
              padding: '11px 16px',
              background: 'var(--brand)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              boxShadow: '0 4px 14px rgba(139, 111, 248, 0.3)'
            }}
          >
            ⚡ Đăng nhập Demo
          </button>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 16px',
            background: loading ? 'rgba(255, 255, 255, 0.1)' : 'var(--surface-hover)',
            color: 'var(--ink)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 16,
            fontWeight: 600
          }}
        >
          {loading ? 'Đang xử lý...' : (mode === 'login' ? 'Đăng nhập' : 'Đăng ký')}
        </button>

        {onForgotPassword && (
          <button
            type="button"
            data-testid="forgot-password-link"
            onClick={onForgotPassword}
            style={{
              padding: '6px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--ink-soft)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600
            }}
          >
            🔑 Quên mật khẩu?
          </button>
        )}
      </form>

      {!hideModeSwitch && (
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            reset();
          }}
          style={{
            padding: '8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--brand)',
            cursor: 'pointer',
            fontSize: 14,
            marginTop: 8
          }}
        >
          {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      )}
    </div>
  );
}
