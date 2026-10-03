import { Link } from 'react-router-dom';
import { InstallExtensionButton } from '../extension/InstallExtensionButton';

/**
 * "Save it now. Remember it later." — final CTA.
 */
export function ExtensionCTA() {
  return (
    <section
      className="section"
      style={{
        background: 'var(--ink)',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(800px 400px at 10% 0%, rgba(91,63,228,0.35), transparent 60%), radial-gradient(700px 500px at 90% 100%, rgba(246,162,107,0.25), transparent 60%)'
        }}
      />
      <div
        className="container"
        style={{ position: 'relative', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Save it now
        </div>
        <h2 className="display h1" style={{ marginTop: 16, color: '#fff', maxWidth: 18 + 'ch' }}>
          Remember it later.
        </h2>
        <p style={{ marginTop: 18, color: 'rgba(255,255,255,0.78)', maxWidth: 56 + 'ch', lineHeight: 1.6 }}>
          Mnemonics is a private, AI-shaped second brain. It works best when it lives where
          you already spend your day — the browser.
        </p>

        <div style={{ marginTop: 32, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <InstallExtensionButton browser="chrome" variant="primary" size="lg" />
          <InstallExtensionButton
            browser="edge"
            variant="ghost"
            size="lg"
            className="mnemonics-final-cta-edge"
          />
          <Link to="/app" className="btn btn--ghost btn--lg" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }}>
            Open web app
          </Link>
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          Chrome · Edge · Brave · Chromium-based browsers
        </div>
      </div>
      <style>{`
        .mnemonics-final-cta-edge {
          color: #fff !important;
          border-color: rgba(255,255,255,0.25) !important;
        }
        .mnemonics-final-cta-edge:hover {
          background: rgba(255,255,255,0.08) !important;
          border-color: #fff !important;
          color: #fff !important;
        }
      `}</style>
    </section>
  );
}
