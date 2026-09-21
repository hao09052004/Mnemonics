/**
 * LoginForm Component
 */

import { useState } from 'react';
import type { ApiClient } from '../lib/api-client';

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: {
    id: string;
    email: string;
    name?: string;
    role: string;
  };
}

interface LoginFormProps {
  api: ApiClient;
  onLogin: (session: Session) => void;
}

export function LoginForm({ api, onLogin }: LoginFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let response;
      if (mode === 'login') {
        response = await api.login({ email, password });
      } else {
        response = await api.register({ email, password, name: name || undefined });
      }

      if (response.data?.accessToken) {
        onLogin(response.data);
      } else {
        setError('Đăng nhập thất bại - không nhận được session');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
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
          minLength={6}
          style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8 }}
        />

        {error && (
          <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
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
            setError(null);
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
