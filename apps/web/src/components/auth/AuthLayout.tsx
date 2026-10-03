import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoginForm } from '../LoginForm';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { ApiClient } from '../../lib/api-client';
import { detectBrowser, installLabelFor } from '../../config/browser';
import { hasChromeExtensionUrl, productConfig } from '../../config/product';
import { MnemonicsWordmark } from '../MnemonicsWordmark';

export type AuthMode = 'login' | 'signup';
export type AuthStep = 'primary' | 'email';

interface AuthLayoutProps {
  api: ApiClient;
  mode: AuthMode;
  onAuthenticated: () => void;
}

/**
 * Editorial auth surface inspired by mymind's calm "single action"
 * feel — but built around Mnemonics' actual identity and APIs.
 *
 * The page has two steps:
 *   1. `primary`    — large serif headline, oversized "Add to Chrome"
 *                     CTA (or "Open the web app" if signed in), and a
 *                     quiet "Use email instead" link.
 *   2. `email`      — the existing LoginForm (mode = login|signup),
 *                     reached when the user wants the email/password
 *                     path. We deliberately don't split registration
 *                     and login into separate visual treatments; the
 *                     component already toggles between the two.
 *
 * No fake OAuth buttons. Mnemonics only ships email/password today,
 * so the primary CTA is the thing that *actually* gets a user into
 * the product — the browser extension.
 */
export function AuthLayout({ api, mode, onAuthenticated }: AuthLayoutProps) {
  const [step, setStep] = useState<AuthStep>('primary');
  const [authed, setAuthed] = useState<boolean>(() => hasSession());
  const [browser] = useState(detectBrowser());
  const label = installLabelFor(browser);
  const webStoreReady = hasChromeExtensionUrl() && label.webStoreReady;

  const onLogin = (next: () => void) => () => {
    setAuthed(true);
    next();
  };

  return (
    <div className="mnemonics-auth-page">
      <header className="mnemonics-auth-header">
        <Link to="/" aria-label="Mnemonics home" className="mnemonics-auth-brand">
          <MnemonicsWordmark />
        </Link>
        <Link to="/" className="mnemonics-auth-back">
          ← Back to home
        </Link>
      </header>

      <main className="mnemonics-auth-main">
        {step === 'primary' ? (
          <PrimaryPanel
            mode={mode}
            authed={authed}
            label={label}
            webStoreReady={webStoreReady}
            onContinueWithEmail={() => setStep('email')}
            onAuthenticated={onAuthenticated}
          />
        ) : (
          <EmailPanel
            api={api}
            mode={mode}
            onAuthenticated={onAuthenticated}
            onBack={() => setStep('primary')}
            onLogin={onLogin}
          />
        )}
      </main>

      <footer className="mnemonics-auth-footer">
        <span>© {new Date().getFullYear()} Mnemonics</span>
        <Link to="/#privacy" className="mnemonics-auth-foot-link">Privacy</Link>
        <Link to="/browser-extension" className="mnemonics-auth-foot-link">Browser extension</Link>
      </footer>

      <AuthStyles />

      {/* Reference the config so the dep is intentional */}
      <span hidden>{String(productConfig.webUrl)}</span>
    </div>
  );
}

function PrimaryPanel({
  mode,
  authed,
  label,
  webStoreReady,
  onContinueWithEmail,
  onAuthenticated
}: {
  mode: AuthMode;
  authed: boolean;
  label: ReturnType<typeof installLabelFor>;
  webStoreReady: boolean;
  onContinueWithEmail: () => void;
  onAuthenticated: () => void;
}) {
  const heading =
    mode === 'signup'
      ? 'Save once.\nRemember anytime.'
      : 'Welcome back\nto your second brain.';

  const subheading =
    mode === 'signup'
      ? 'Start by adding Mnemonics to your browser. Your first memory is one click away.'
      : 'Pick up where you left off. Continue with the extension or sign in below.';

  const primaryCta = authed
    ? { kind: 'link' as const, label: 'Open the web app', to: '/app' }
    : { kind: 'install' as const, label: label.primary };

  return (
    <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
      <div className="eyebrow">{mode === 'signup' ? 'Get started' : 'Sign in'}</div>
      <h1 id="auth-heading" className="display h1 mnemonics-auth-heading">
        {heading.split('\n').map((line, i) => (
          <span key={i} style={{ display: 'block' }}>
            {line}
          </span>
        ))}
      </h1>
      <p className="lead mnemonics-auth-lead">{subheading}</p>

      <div className="mnemonics-auth-cta">
        {primaryCta.kind === 'install' ? (
          <button
            type="button"
            data-testid="auth-primary-cta"
            className="btn btn--primary btn--xl"
            onClick={() => {
              if (webStoreReady) {
                window.open(productConfig.chromeExtensionUrl, '_blank', 'noopener,noreferrer');
              } else {
                // Trigger the existing install-modal by opening a synthetic
                // click on the InstallExtensionButton. For simplicity here,
                // we just route to the extension landing page where the
                // user can read more + load the dev build.
                window.location.assign('/browser-extension');
              }
              onAuthenticated();
            }}
          >
            <ChromeGlyph />
            <span>{primaryCta.label}</span>
          </button>
        ) : (
          <Link
            to={primaryCta.to}
            data-testid="auth-primary-cta"
            className="btn btn--primary btn--xl"
            onClick={onAuthenticated}
          >
            {primaryCta.label} →
          </Link>
        )}

        <button
          type="button"
          className="mnemonics-auth-secondary"
          onClick={onContinueWithEmail}
        >
          {mode === 'signup' ? 'Use email instead' : 'Continue with email'} →
        </button>
      </div>

      <p className="mnemonics-auth-foot">
        By continuing you agree to our <Link to="/#privacy">privacy promise</Link>.
        {' '}Works on Chrome, Brave, Edge, and any Chromium-based browser.
      </p>
    </section>
  );
}

function EmailPanel({
  api,
  mode,
  onAuthenticated,
  onBack,
  onLogin
}: {
  api: ApiClient;
  mode: AuthMode;
  onAuthenticated: () => void;
  onBack: () => void;
  onLogin: (next: () => void) => () => void;
}) {
  const [view, setView] = useState<'auth' | 'forgot'>('auth');

  if (view === 'forgot') {
    return (
      <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
        <h2 id="auth-heading" className="display h2" style={{ marginBottom: 8 }}>
          Reset your password
        </h2>
        <p className="lead mnemonics-auth-lead" style={{ marginBottom: 24 }}>
          Enter your email and we'll send a link if the account exists.
        </p>
        <ForgotPasswordForm
          api={api}
          onCancel={() => setView('auth')}
          onResetRequested={() => undefined}
        />
        <button
          type="button"
          className="mnemonics-auth-secondary"
          onClick={onBack}
          style={{ marginTop: 16 }}
        >
          ← Back
        </button>
      </section>
    );
  }

  return (
    <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
      <div className="eyebrow">{mode === 'signup' ? 'Create account' : 'Sign in with email'}</div>
      <h1 id="auth-heading" className="display h2" style={{ marginBottom: 24 }}>
        {mode === 'signup' ? 'Just a few details.' : 'Welcome back.'}
      </h1>

      <div className="mnemonics-auth-form-shell">
        <LoginForm
          api={api}
          onLogin={onLogin(onAuthenticated)}
          onForgotPassword={() => setView('forgot')}
          hideModeSwitch
          initialMode={mode === 'signup' ? 'register' : 'login'}
        />
      </div>

      <div className="mnemonics-auth-foot" style={{ marginTop: 24, textAlign: 'center' }}>
        {mode === 'signup' ? (
          <>
            Already have an account? <Link to="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link to="/signup">Create an account</Link>
          </>
        )}
      </div>

      <button
        type="button"
        className="mnemonics-auth-secondary"
        onClick={onBack}
        style={{ marginTop: 8 }}
      >
        ← Back to the extension option
      </button>
    </section>
  );
}

function ChromeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.18)" />
      <path
        d="M12 4.5a7.5 7.5 0 0 0-6.36 3.51L12 12l5.32-3.27A4.5 4.5 0 0 0 12 4.5Z"
        fill="#fff"
      />
      <circle cx="12" cy="12" r="3.5" fill="#5b3fe4" />
      <path
        d="M5.64 8.01A7.5 7.5 0 0 0 9 19.5l3-7.5-6.36-4Z"
        fill="#fff"
        fillOpacity="0.85"
      />
      <path
        d="M18.36 8.01 12 12l3 7.5a7.5 7.5 0 0 0 3.36-11.49Z"
        fill="#fff"
        fillOpacity="0.65"
      />
    </svg>
  );
}

function hasSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem('mnemonics_session'));
  } catch {
    return false;
  }
}

function AuthStyles() {
  // Scoped styles for the auth page. Kept here rather than in
  // global.css so the auth surface can be redesigned independently
  // from the marketing site. The whole block is small enough to ship
  // as a single <style> tag with no measurable bundle cost.
  return (
    <style>{`
      .mnemonics-auth-page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--bg);
        color: var(--ink);
      }
      .mnemonics-auth-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 32px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
      }
      .mnemonics-auth-brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
        font-size: 17px;
        color: var(--ink);
      }
      .mnemonics-auth-back {
        font-size: 14px;
        color: var(--muted);
        font-weight: 500;
      }
      .mnemonics-auth-back:hover { color: var(--ink); }
      .mnemonics-auth-main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
      }
      .mnemonics-auth-panel {
        width: 100%;
        max-width: 540px;
        text-align: left;
      }
      .mnemonics-auth-heading {
        margin-top: 18px;
        margin-bottom: 22px;
        white-space: pre-line;
      }
      .mnemonics-auth-lead {
        margin-bottom: 40px;
        max-width: 44ch;
      }
      .mnemonics-auth-cta {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 18px;
      }
      .mnemonics-auth-cta .btn--primary,
      .mnemonics-auth-cta a.btn--primary {
        width: 100%;
        padding: 22px 28px;
        font-size: 18px;
        justify-content: center;
      }
      .btn--xl {
        padding: 22px 28px !important;
        font-size: 18px !important;
      }
      .mnemonics-auth-secondary {
        background: transparent;
        border: none;
        color: var(--muted);
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        padding: 12px 0;
        text-align: center;
        transition: color 0.15s ease;
      }
      .mnemonics-auth-secondary:hover { color: var(--ink); }
      .mnemonics-auth-foot {
        margin-top: 32px;
        font-size: 13px;
        color: var(--muted);
        line-height: 1.55;
      }
      .mnemonics-auth-foot a {
        color: var(--ink);
        text-decoration: underline;
        text-decoration-color: var(--border-strong);
        text-underline-offset: 3px;
      }
      .mnemonics-auth-form-shell {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 28px 24px;
        box-shadow: var(--shadow-sm);
      }
      .mnemonics-auth-footer {
        padding: 24px 32px 32px;
        display: flex;
        gap: 24px;
        justify-content: center;
        font-size: 13px;
        color: var(--muted);
        flex-wrap: wrap;
      }
      .mnemonics-auth-foot-link { color: var(--muted); }
      .mnemonics-auth-foot-link:hover { color: var(--ink); }
      @media (max-width: 640px) {
        .mnemonics-auth-header { padding: 18px 20px; }
        .mnemonics-auth-main { padding: 20px; align-items: flex-start; padding-top: 32px; }
        .mnemonics-auth-heading { font-size: 40px !important; }
        .mnemonics-auth-cta .btn--xl { padding: 18px 22px; font-size: 16px; }
      }
    `}</style>
  );
}
