import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm';
import { ApiClient } from '../lib/api-client';
import { productConfig } from '../config/product';

interface LoginPageProps {
  api: ApiClient;
}

/**
 * Marketing-framed login. The actual form is the same LoginForm
 * component the dashboard already used — we just wrap it in a
 * brand-split layout so it feels like part of the public site.
 */
export function LoginPage({ api }: LoginPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    document.title = 'Log in — Mnemonics';
    setMeta('description', 'Log in to Mnemonics. Save once, remember anytime.');
  }, []);

  const onLogin = () => {
    const next = params.get('next') || '/app';
    navigate(next, { replace: true });
  };

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
              'radial-gradient(700px 400px at 0% 100%, rgba(91,63,228,0.45), transparent 60%), radial-gradient(600px 320px at 100% 0%, rgba(246,162,107,0.30), transparent 60%)'
          }}
        />
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>Mnemonics</div>
            <h2 className="display h2" style={{ marginTop: 14, color: '#fff' }}>
              Your second brain,
              <br />
              one tab away.
            </h2>
            <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.75)', maxWidth: 36 + 'ch', lineHeight: 1.6 }}>
              Sign in to open the dashboard, search your memories, and continue saving from
              anywhere on the web.
            </p>
          </div>
          <Collage />
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
          <LoginForm
            api={api}
            onLogin={onLogin}
            onForgotPassword={() => navigate('/reset-password')}
          />
        </div>
      </main>

      <style>{`
        @media (max-width: 860px) {
          .mnemonics-auth-grid { grid-template-columns: 1fr !important; }
          .mnemonics-auth-aside { display: none; }
          .mnemonics-auth-main { padding: 32px 20px !important; }
        }
      `}</style>

      {/* Reference the config so the dep is intentional */}
      <span hidden>{String(productConfig.webUrl)}</span>
    </div>
  );
}

function Collage() {
  // A small, deliberately-loose stack of "memory cards" so the dark
  // side never feels empty. Pure CSS — no image assets.
  return (
    <div style={{ position: 'relative', height: 280, marginTop: 32 }}>
      <Card style={{ left: 0, top: 0, transform: 'rotate(-3deg)', background: 'var(--brand)' }}>A field guide to PKM</Card>
      <Card style={{ left: 120, top: 30, transform: 'rotate(2deg)', background: '#f6a26b' }}>“Best interface = none.”</Card>
      <Card style={{ left: 40, top: 130, transform: 'rotate(4deg)', background: '#fdfcf8', color: 'var(--ink)' }}>
        Q3 OKRs draft
      </Card>
      <Card style={{ left: 200, top: 160, transform: 'rotate(-2deg)', background: '#ede9fe', color: 'var(--ink)' }}>
        Screenshot · settings
      </Card>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        color: '#fff',
        padding: '14px 18px',
        borderRadius: 14,
        fontFamily: 'var(--font-display)',
        fontSize: 16,
        lineHeight: 1.3,
        maxWidth: 220,
        boxShadow: 'var(--shadow-md)',
        ...style
      }}
    >
      {children}
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
