import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ApiClient } from '../lib/api-client';
import { useLocale } from '../lib/locale';

interface LoginPageProps {
  api: ApiClient;
}

export function LoginPage({ api }: LoginPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { locale } = useLocale();

  useEffect(() => {
    document.title = locale === 'vi' ? 'Đăng nhập — Mnemonics' : 'Log in — Mnemonics';
    setMeta(
      'description',
      locale === 'vi'
        ? 'Đăng nhập vào Mnemonics. Lưu một lần, nhớ mọi lúc.'
        : 'Log in to Mnemonics. Save once, remember anytime.'
    );
  }, [locale]);

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
