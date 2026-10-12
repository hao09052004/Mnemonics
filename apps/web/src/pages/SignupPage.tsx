import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ApiClient } from '../lib/api-client';

interface SignupPageProps {
  api: ApiClient;
}

export function SignupPage({ api }: SignupPageProps) {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = 'Create your Mnemonics account';
    setMeta(
      'description',
      'Create a Mnemonics account to start saving pages, highlights and screenshots.'
    );
  }, []);

  return (
    <AuthLayout
      api={api}
      mode="signup"
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
