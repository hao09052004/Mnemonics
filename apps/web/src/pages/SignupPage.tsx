import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
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
    <div
      style={{
        minHeight: 'calc(100vh - var(--header-h))',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)'
      }}
      className="mnemonics-auth-grid"
    >
      <aside
        style={{
          background: 'var(--ink)',
          color: '#fff',
          padding: '64px 56px',
          position: 'relative',
          overflow: 'hidden'
        }}
        className="mnemonics-auth-aside"
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(700px 400px at 100% 0%, rgba(246,162,107,0.35), transparent 60%), radial-gradient(600px 320px at 0% 100%, rgba(91,63,228,0.45), transparent 60%)'
          }}
        />
        <div style={{ position: 'relative' }}>
          <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>Start saving</div>
          <h2 className="display h2" style={{ marginTop: 14, color: '#fff' }}>
            Build a library
            <br />
            that thinks with you.
          </h2>
          <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.75)', maxWidth: 36 + 'ch', lineHeight: 1.6 }}>
            Create an account in under a minute. We email a verification link, then you're in.
          </p>
        </div>
      </aside>

      <main
        style={{
          background: 'var(--bg)',
          padding: '64px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        className="mnemonics-auth-main"
      >
        <div style={{ width: '100%', maxWidth: 400 }}>
          <LoginForm api={api} onLogin={() => navigate('/app', { replace: true })} />
          <p style={{ marginTop: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Already have an account? <a href="/login" style={{ color: 'var(--brand)', fontWeight: 600 }}>Log in</a>
          </p>
        </div>
      </main>

      <style>{`
        @media (max-width: 860px) {
          .mnemonics-auth-grid { grid-template-columns: 1fr !important; }
          .mnemonics-auth-aside { display: none; }
          .mnemonics-auth-main { padding: 32px 20px !important; }
        }
      `}</style>
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
