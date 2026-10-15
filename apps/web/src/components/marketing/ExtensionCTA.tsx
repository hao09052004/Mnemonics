import { Link } from 'react-router-dom';
import { InstallExtensionButton } from '../extension/InstallExtensionButton';
import { useLocale } from '../../lib/locale';

/**
 * "Save it now. Remember it later." — final CTA.
 */
export function ExtensionCTA() {
  const { t } = useLocale();

  return (
    <section
      className="section"
      data-theme="dark"
      style={{
        background: '#0c0e14',
        color: '#f2f3f5',
        position: 'relative',
        overflow: 'hidden',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        paddingTop: 100,
        paddingBottom: 110
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(800px 420px at 20% 0%, rgba(124, 92, 252, 0.22), transparent 70%), radial-gradient(700px 500px at 80% 100%, rgba(245, 158, 11, 0.12), transparent 70%)',
          pointerEvents: 'none'
        }}
      />
      {/* Fine grid dot texture */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 80%)',
          opacity: 0.6,
          pointerEvents: 'none'
        }}
      />
      <div
        className="container"
        style={{ position: 'relative', zIndex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div className="eyebrow" style={{ color: 'var(--brand)' }}>
          {t('cta_eyebrow', 'Save it now')}
        </div>
        <h2 className="display h1 mn-hero-headline" style={{ marginTop: 16, color: '#f2f3f5', maxWidth: 18 + 'ch' }}>
          <span className="mn-hero-gradient-text">{t('cta_headline', 'Remember it later.')}</span>
        </h2>
        <p style={{ marginTop: 18, color: '#a2a9b8', maxWidth: 56 + 'ch', lineHeight: 1.6, fontSize: 16 }}>
          {t('cta_lead', 'Mnemonics is a private, AI-shaped second brain. It works best when it lives where you already spend your day — the browser.')}
        </p>

        <div style={{ marginTop: 32, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <InstallExtensionButton browser="chrome" variant="primary" size="lg" />
          <InstallExtensionButton
            browser="edge"
            variant="secondary"
            size="lg"
          />
          <Link to="/app" className="btn btn--outline btn--lg">
            {t('cta_open_web_app', 'Open web app')}
          </Link>
        </div>
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>
          Chrome · Edge · Brave · Chromium-based browsers
        </div>
      </div>
    </section>
  );
}
