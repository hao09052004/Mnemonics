import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { ApiClient } from '../lib/api-client';
import { useLocale } from '../lib/locale';

interface SignupPageProps {
  api: ApiClient;
}

export function SignupPage({ api }: SignupPageProps) {
  const navigate = useNavigate();
  const { locale } = useLocale();

  useEffect(() => {
    document.title = locale === 'vi' ? 'Tạo tài khoản Mnemonics' : 'Create your Mnemonics account';
    setMeta(
      'description',
      locale === 'vi'
        ? 'Tạo tài khoản Mnemonics để bắt đầu lưu trang, trích dẫn và ảnh chụp màn hình.'
        : 'Create a Mnemonics account to start saving pages, highlights and screenshots.'
    );
  }, [locale]);

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
