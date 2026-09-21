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
}

export function LoginForm({ api, onLogin }: LoginFormProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setInfo(null);
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
    <div style={{ maxWidth: 400, margin: '64px auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 32 }}>
        Mnemonics
      </h1>

      <h2 style={{ fontSize: 18, marginBottom: 16, textAlign: 'center' }}>
        {mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
      </h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu"
          required
          minLength={10}
          style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
        />

        {info && (
          <div
            role="status"
            data-testid="login-info"
            style={{ padding: 12, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, color: '#047857', fontSize: 13 }}
          >
            {info}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 8, color: '#dc2626', fontSize: 13 }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 16px',
            background: loading ? '#ccc' : '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 16,
            fontWeight: 600
          }}
        >
          {loading ? 'Đang xử lý...' : (mode === 'login' ? 'Đăng nhập' : 'Đăng ký')}
        </button>

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
            color: '#4f46e5',
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
