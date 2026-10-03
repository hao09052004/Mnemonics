import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';
import { ApiClient } from '../lib/api-client';

interface ResetPasswordPageProps {
  api: ApiClient;
}

export function ResetPasswordPage({ api }: ResetPasswordPageProps) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = 'Reset your password — Mnemonics';
    setMeta(
      'description',
      'Forgot your Mnemonics password? Request a reset link and we will email it to you.'
    );
  }, []);

  return (
    <div
      style={{
        minHeight: 'calc(100vh - var(--header-h))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <ForgotPasswordForm
          api={api}
          onCancel={() => navigate('/login')}
          onResetRequested={() => undefined}
        />
      </div>
    </div>
  );
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}
