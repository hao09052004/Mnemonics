import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ApiClient } from '../lib/api-client';

interface LoginPageProps {
  api: ApiClient;
}

export function LoginPage({ api }: LoginPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    document.title = 'Log in — Mnemonics';
    setMeta('description', 'Log in to Mnemonics. Save once, remember anytime.');
  }, []);

  const next = params.get('next') || '/app';

  return (
    <AuthLayout
      api={api}
      mode="login"
      onAuthenticated={() => navigate(next, { replace: true })}
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
