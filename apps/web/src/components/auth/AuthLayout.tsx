import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoginForm } from '../LoginForm';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import { ApiClient } from '../../lib/api-client';
import { detectBrowser, installLabelFor } from '../../config/browser';
import { hasChromeExtensionUrl, productConfig } from '../../config/product';
import { MnemonicsWordmark } from '../MnemonicsWordmark';
import { useLocale } from '../../lib/locale';

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
  const { t } = useLocale();
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
          {t('auth_back_home', '← Back to home')}
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
        <Link to="/#privacy" className="mnemonics-auth-foot-link">{t('nav_privacy', 'Privacy')}</Link>
        <Link to="/browser-extension" className="mnemonics-auth-foot-link">{t('nav_extension', 'Browser extension')}</Link>
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
  const { t } = useLocale();

  const heading =
    mode === 'signup'
      ? `${t('auth_signup_h1_1', 'Save once.')}\n${t('auth_signup_h1_2', 'Remember anytime.')}`
      : `${t('auth_login_h1_1', 'Welcome back')}\n${t('auth_login_h1_2', 'to your second brain.')}`;

  const subheading =
    mode === 'signup'
      ? t('auth_signup_sub', 'Start by adding Mnemonics to your browser. Your first memory is one click away.')
      : t('auth_login_sub', 'Pick up where you left off. Continue with the extension or sign in below.');

  const primaryCta = authed
    ? { kind: 'link' as const, label: t('cta_open_web_app', 'Open the web app'), to: '/app' }
    : { kind: 'install' as const, label: label.primary };

  return (
    <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
      <div className="eyebrow">{mode === 'signup' ? t('auth_signup_eyebrow', 'Get started') : t('auth_login_eyebrow', 'Sign in')}</div>
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
          {mode === 'signup' ? t('auth_use_email_instead', 'Use email instead') : t('auth_continue_with_email', 'Continue with email')} →
        </button>
      </div>

      <p className="mnemonics-auth-foot">
        {t('auth_agree_prefix', 'By continuing you agree to our')} <Link to="/#privacy">{t('auth_privacy_promise', 'privacy promise')}</Link>.
        {' '}{t('auth_browser_compat', 'Works on Chrome, Brave, Edge, and any Chromium-based browser.')}
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
  const { t } = useLocale();

  if (view === 'forgot') {
    return (
      <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
        <h2 id="auth-heading" className="display h2" style={{ marginBottom: 8 }}>
          {t('auth_reset_password_title', 'Reset your password')}
        </h2>
        <p className="lead mnemonics-auth-lead" style={{ marginBottom: 24 }}>
          {t('auth_reset_password_lead', "Enter your email and we'll send a link if the account exists.")}
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
          {t('btn_back', '← Back')}
        </button>
      </section>
    );
  }

  return (
    <section className="mnemonics-auth-panel" aria-labelledby="auth-heading">
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="eyebrow" style={{ color: '#a78bfa', letterSpacing: '1.2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
          {mode === 'signup' ? t('auth_signup_form_eyebrow', 'Create account') : t('auth_login_form_eyebrow', 'Sign in with email')}
        </div>
        <h1 id="auth-heading" className="display h2 mnemonics-auth-heading" style={{ margin: '8px 0 0', fontSize: 30, fontWeight: 750, letterSpacing: '-0.5px', color: '#ffffff' }}>
          {mode === 'signup' ? t('auth_signup_form_h1', 'Just a few details.') : t('auth_login_form_h1', 'Welcome back.')}
        </h1>
      </div>

      <div className="mnemonics-auth-form-shell">
        <LoginForm
          api={api}
          onLogin={onLogin(onAuthenticated)}
          onForgotPassword={() => setView('forgot')}
          hideModeSwitch
          initialMode={mode === 'signup' ? 'register' : 'login'}
        />
      </div>

      <div className="mnemonics-auth-foot" style={{ marginTop: 22, textAlign: 'center', fontSize: 13.5 }}>
        {mode === 'signup' ? (
          <>
            {t('auth_already_have_acc', 'Already have an account?')}{' '}
            <Link to="/login" style={{ color: '#a78bfa', fontWeight: 600, marginLeft: 4 }}>
              {t('nav_login', 'Log in')}
            </Link>
          </>
        ) : (
          <>
            {t('auth_new_here', 'New here?')}{' '}
            <Link to="/signup" style={{ color: '#a78bfa', fontWeight: 600, marginLeft: 4 }}>
              {t('auth_create_acc', 'Create an account')}
            </Link>
          </>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <button
          type="button"
          className="mnemonics-auth-secondary"
          onClick={onBack}
          style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.45)', padding: '6px 12px' }}
        >
          {t('btn_back', '← Back to the extension option')}
        </button>
      </div>
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
  // from the marketing site.
  return (
    <style>{`
      .mnemonics-auth-page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background:
          radial-gradient(circle 800px at 50% -100px, rgba(116, 87, 232, 0.18) 0%, rgba(91, 63, 228, 0.05) 50%, transparent 80%),
          radial-gradient(circle 500px at 85% 85%, rgba(116, 87, 232, 0.07) 0%, transparent 70%),
          #0b0d14;
        color: #ffffff;
        position: relative;
        overflow-x: hidden;
      }
      .mnemonics-auth-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 32px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
      }
      .mnemonics-auth-brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
        font-size: 17px;
        color: #ffffff;
        text-decoration: none;
        transition: opacity 0.15s ease;
      }
      .mnemonics-auth-brand:hover { opacity: 0.88; }
      .mnemonics-auth-back {
        font-size: 13.5px;
        color: rgba(255, 255, 255, 0.55);
        font-weight: 500;
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .mnemonics-auth-back:hover { color: #ffffff; }
      .mnemonics-auth-main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 20px;
      }
      .mnemonics-auth-panel {
        width: 100%;
        max-width: 460px;
        text-align: left;
        animation: authFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes authFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .mnemonics-auth-heading {
        margin-top: 14px;
        margin-bottom: 18px;
        white-space: pre-line;
      }
      .mnemonics-auth-lead {
        margin-bottom: 32px;
        max-width: 44ch;
        color: rgba(255, 255, 255, 0.65);
        font-size: 15px;
        line-height: 1.55;
      }
      .mnemonics-auth-cta {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 16px;
      }
      .mnemonics-auth-cta .btn--primary,
      .mnemonics-auth-cta a.btn--primary {
        width: 100%;
        box-sizing: border-box;
        padding: 16px 24px;
        font-size: 16px;
        font-weight: 600;
        justify-content: center;
        border-radius: 14px;
        background: linear-gradient(135deg, #7457e8 0%, #5b3fe4 100%);
        color: #ffffff;
        border: none;
        box-shadow: 0 4px 20px rgba(116, 87, 232, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25);
        transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
      }
      .mnemonics-auth-cta .btn--primary:hover,
      .mnemonics-auth-cta a.btn--primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(116, 87, 232, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.35);
        filter: brightness(1.06);
      }
      .btn--xl {
        padding: 16px 24px !important;
        font-size: 16px !important;
      }
      .mnemonics-auth-secondary {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        padding: 10px 0;
        text-align: center;
        transition: color 0.15s ease;
      }
      .mnemonics-auth-secondary:hover { color: #ffffff; }
      .mnemonics-auth-foot {
        margin-top: 24px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.5);
        line-height: 1.55;
      }
      .mnemonics-auth-foot a {
        color: #a78bfa;
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .mnemonics-auth-foot a:hover {
        color: #c4b5fd;
        text-decoration: underline;
      }
      .mnemonics-auth-form-shell {
        background: linear-gradient(180deg, rgba(22, 25, 38, 0.78) 0%, rgba(14, 16, 26, 0.88) 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 22px;
        padding: 32px 28px;
        box-shadow:
          0 24px 50px -12px rgba(0, 0, 0, 0.75),
          0 0 0 1px rgba(255, 255, 255, 0.04),
          0 0 45px -8px rgba(116, 87, 232, 0.2);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        position: relative;
      }
      .mnemonics-auth-form-shell::before {
        content: '';
        position: absolute;
        top: 0;
        left: 20%;
        right: 20%;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.6), transparent);
      }
      .mnemonics-auth-footer {
        padding: 24px 32px 32px;
        display: flex;
        gap: 24px;
        justify-content: center;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.4);
        flex-wrap: wrap;
      }
      .mnemonics-auth-foot-link {
        color: rgba(255, 255, 255, 0.45);
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .mnemonics-auth-foot-link:hover { color: #ffffff; }
      @media (max-width: 640px) {
        .mnemonics-auth-header { padding: 18px 20px; }
        .mnemonics-auth-main { padding: 20px; align-items: flex-start; padding-top: 24px; }
        .mnemonics-auth-heading { font-size: 32px !important; }
        .mnemonics-auth-form-shell { padding: 24px 20px; }
      }
    `}</style>
  );
}
