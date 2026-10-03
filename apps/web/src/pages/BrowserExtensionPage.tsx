import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrowserSelector } from '../components/extension/BrowserSelector';
import { InstallExtensionButton } from '../components/extension/InstallExtensionButton';
import { MemoryMasonry } from '../components/marketing/MemoryMasonry';
import { PrivacySection } from '../components/marketing/PrivacySection';
import { ExtensionCTA } from '../components/marketing/ExtensionCTA';

export function BrowserExtensionPage() {
  useEffect(() => {
    document.title = 'Mnemonics Browser Extension — Save Anything in One Click';
    setMeta(
      'description',
      'Save pages, text, images and screenshots from any tab. The Mnemonics browser extension keeps your second brain one click away.'
    );
  }, []);

  return (
    <>
      <section
        className="section"
        style={{ paddingTop: 96, paddingBottom: 80, position: 'relative', overflow: 'hidden' }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(900px 480px at 80% 0%, rgba(91,63,228,0.18), transparent 60%), radial-gradient(700px 400px at 0% 100%, rgba(246,162,107,0.18), transparent 60%)',
            pointerEvents: 'none'
          }}
        />
        <div className="container" style={{ position: 'relative', maxWidth: 820 }}>
          <div className="eyebrow">Browser extension</div>
          <h1 className="display h1" style={{ marginTop: 16 }}>
            The browser extension
            <br />
            for your second brain.
          </h1>
          <p className="lead" style={{ marginTop: 22 }}>
            Save pages, images, highlights and screenshots without breaking your flow. Mnemonics
            lives where you already read, write and think — your browser.
          </p>

          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <InstallExtensionButton size="lg" />
            <Link to="/app" className="btn btn--ghost btn--lg">
              Open the web app →
            </Link>
          </div>

          <BrowserSelector />
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
            Firefox and Safari are on the roadmap. The extension currently ships on Chromium-based browsers.
          </p>
        </div>
      </section>

      <Section
        eyebrow="Capture"
        title="One click and it's remembered."
        body="Click the Mnemonics button while you're on a page. We save the article in the background, generate a stable id, and surface it in your dashboard the moment it's ready."
      />
      <Section
        eyebrow="Text & images"
        title="Save text and images without interrupting your flow."
        body="Highlight something and right-click → Save to Mnemonics. Right-click an image → Save image. We extract the text, fingerprint the source, and quietly fit it into your library."
      />
      <Section
        eyebrow="Screenshots"
        title="Capture screenshots and crop exactly what matters."
        body="Capture the visible tab, drag a rectangle, save. Screenshots go through OCR so a future text search can pull them out — even the words inside an image."
      />
      <Section
        eyebrow="Context"
        title="Add context while you save."
        body="Drop in a quick note before saving. Mnemonics keeps the note attached to the memory, so the next time you find it you remember why you saved it."
      />
      <Section
        eyebrow="Recall"
        title="Find it again through Mnemonics."
        body="Your saves appear in the dashboard. Search by words, by tags, or by meaning — semantic recall surfaces memories even when the title no longer rings a bell."
      />

      <MemoryMasonry />
      <PrivacySection />
      <ExtensionCTA />
    </>
  );
}

function Section({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="section section--tight">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="display h2" style={{ marginTop: 14 }}>
          {title}
        </h2>
        <p className="lead" style={{ marginTop: 18 }}>
          {body}
        </p>
      </div>
    </section>
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
