import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ApiClient } from '../lib/api-client';

interface ResetPasswordPageProps {
  api: ApiClient;
}

/**
 * Deep-link entry to the forgot-password flow.
 *
 * The /login page already exposes "Continue with email" → "Forgot
 * password" inline. This page exists so that email links (e.g. the
 * "Reset your password" footer link a future email template will
 * include) can land users on a page that opens the forgot-password
 * step directly, in the same calm auth shell.
 */
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
    <AuthLayout
      api={api}
      mode="login"
      onAuthenticated={() => navigate('/app', { replace: true })}
    />
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
