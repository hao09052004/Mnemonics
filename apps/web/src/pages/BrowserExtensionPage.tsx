import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrowserSelector } from '../components/extension/BrowserSelector';
import { InstallExtensionButton } from '../components/extension/InstallExtensionButton';
import { MemoryMasonry } from '../components/marketing/MemoryMasonry';
import { PrivacySection } from '../components/marketing/PrivacySection';
import { ExtensionCTA } from '../components/marketing/ExtensionCTA';
import { useLocale } from '../lib/locale';

export function BrowserExtensionPage() {
  const { t, locale } = useLocale();

  useEffect(() => {
    document.title = locale === 'vi'
      ? 'Tiện ích mở rộng Mnemonics cho Chrome & Edge'
      : 'Mnemonics Browser Extension for Chrome & Edge';
    setMeta(
      'description',
      'Save pages, highlights, images and screenshots directly from Chrome or Microsoft Edge. The Mnemonics browser extension keeps your second brain one click away.'
    );
  }, [locale]);

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
          <div className="eyebrow">{t('ext_page_eyebrow', 'Browser extension')}</div>
          <h1 className="display h1" style={{ marginTop: 16 }}>
            {t('ext_page_h1_1', 'The browser extension')}
            <br />
            {t('ext_page_h1_2', 'for your second brain.')}
          </h1>
          <p className="lead" style={{ marginTop: 22 }}>
            {t('ext_page_lead', 'Save pages, images, highlights and screenshots without breaking your flow. Mnemonics lives where you already read, write and think — your browser.')}
          </p>

          {/*
            Two install CTAs: Chrome is primary (visually heavier, listed
            first), Edge is a secondary supported alternative. Both fall
            back to a "release coming soon" modal when the corresponding
            store URL env-var is unset — they never link to a broken URL.
          */}
          <div
            style={{
              marginTop: 28,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center'
            }}
            data-testid="extension-cta-row"
          >
            <InstallExtensionButton browser="chrome" variant="primary" size="lg" />
            <InstallExtensionButton browser="edge" variant="secondary" size="lg" />
            <Link to="/app" className="btn btn--ghost btn--lg">
              {t('hero_open_web_app', 'Open the web app →')}
            </Link>
          </div>

          <BrowserSelector />
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
            {locale === 'vi'
              ? 'Firefox và Safari đang trong lộ trình phát triển. Tiện ích hiện hỗ trợ các trình duyệt nhân Chromium (Chrome, Edge, Brave, Opera).'
              : 'Firefox and Safari are on the roadmap. The extension currently ships on Chromium-based browsers (Chrome, Edge, Brave, Opera).'}
          </p>
        </div>
      </section>

      <Section
        eyebrow={t('ext_sec1_eyebrow', 'Capture')}
        title={t('ext_sec1_title', "One click and it's remembered.")}
        body={t('ext_sec1_body', "Click the Mnemonics button while you're on a page. We save the article in the background, generate a stable id, and surface it in your dashboard the moment it's ready.")}
      />
      <Section
        eyebrow={t('ext_sec2_eyebrow', 'Text & images')}
        title={t('ext_sec2_title', 'Save text and images without interrupting your flow.')}
        body={t('ext_sec2_body', 'Highlight something and right-click → Save to Mnemonics. Right-click an image → Save image. We extract the text, fingerprint the source, and quietly fit it into your library.')}
      />
      <Section
        eyebrow={t('ext_sec3_eyebrow', 'Screenshots')}
        title={t('ext_sec3_title', 'Capture screenshots and crop exactly what matters.')}
        body={t('ext_sec3_body', "Capture the visible tab, drag a rectangle, save. Screenshots go through OCR so a future text search can pull them out — even the words inside an image.")}
      />
      <Section
        eyebrow={t('ext_sec4_eyebrow', 'Context')}
        title={t('ext_sec4_title', 'Add context while you save.')}
        body={t('ext_sec4_body', 'Drop in a quick note before saving. Mnemonics keeps the note attached to the memory, so the next time you find it you remember why you saved it.')}
      />
      <Section
        eyebrow={t('ext_sec5_eyebrow', 'Recall')}
        title={t('ext_sec5_title', 'Find it again through Mnemonics.')}
        body={t('ext_sec5_body', 'Your saves appear in the dashboard. Search by words, by tags, or by meaning — semantic recall surfaces memories even when the title no longer rings a bell.')}
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
