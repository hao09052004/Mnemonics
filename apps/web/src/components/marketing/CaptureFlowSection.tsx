import { Link } from 'react-router-dom';
import { useLocale } from '../../lib/locale';

export function CaptureFlowSection() {
  const { t } = useLocale();

  return (
    <section className="section">
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">{t('flow_eyebrow', 'Flows')}</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            {t('flow_headline_1', 'Capture without leaving')}
            <br />
            {t('flow_headline_2', "what you're doing.")}
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            {t('flow_lead', 'Three gestures cover almost every web moment: highlight something you care about, right-click an image, or grab a screenshot. Mnemonics handles the rest.')}
          </p>
        </div>

        <div
          style={{
            marginTop: 48,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 22
          }}
        >
          <FlowTile
            number="01"
            title={t('flow_tile_1_title', 'Highlight text')}
            body={t('flow_tile_1_body', 'Select any passage on a page. Right-click → Save to Mnemonics. The original source is kept, the quote is extracted, and the right tags appear without you typing them.')}
            mockup={<HighlightMockup />}
          />
          <FlowTile
            number="02"
            title={t('flow_tile_2_title', 'Save an image')}
            body={t('flow_tile_2_body', 'Right-click on an image → Save image. Mnemonics stores a local copy, fingerprints where it came from, and surfaces it whenever a related memory is recalled.')}
            mockup={<ImageMockup />}
          />
          <FlowTile
            number="03"
            title={t('flow_tile_3_title', 'Crop a screenshot')}
            body={t('flow_tile_3_body', "Capture the visible tab, drag a rectangle around what matters, save. Screenshots get OCR'd and embedded, so a text search can find them later.")}
            mockup={<ScreenshotMockup />}
          />
        </div>

        <div style={{ marginTop: 40 }}>
          <Link to="/browser-extension" className="btn btn--ghost btn--lg">
            {t('flow_guide_link', 'See all capture gestures →')}
          </Link>
        </div>
      </div>
    </section>
  );
}

function FlowTile({
  number,
  title,
  body,
  mockup
}: {
  number: string;
  title: string;
  body: string;
  mockup: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        minHeight: 360,
        background: 'var(--surface)',
        border: '1px solid var(--border)'
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: '0.16em', color: 'var(--brand)', fontWeight: 700 }}>{number}</div>
      <div style={{ minHeight: 180 }}>{mockup}</div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>{title}</div>
        <p style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55 }}>{body}</p>
      </div>
    </div>
  );
}

function HighlightMockup() {
  const { locale } = useLocale();
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        padding: 16,
        position: 'relative'
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
        {locale === 'vi' ? '“Giao diện tốt nhất là giao diện ' : '“The best '}
        <Mark word={locale === 'vi' ? 'vô hình' : 'disappears'} />
        {locale === 'vi' ? '.”' : '.”'}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 14,
          top: 36,
          background: 'var(--brand)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(139, 111, 248, 0.4)'
        }}
      >
        {locale === 'vi' ? 'Lưu vào Mnemonics' : 'Save to Mnemonics'}
      </div>
    </div>
  );
}

function Mark({ word = 'interface' }: { word?: string }) {
  return (
    <span style={{ background: 'rgba(139, 111, 248, 0.25)', color: '#c4b5fd', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
      {word}
    </span>
  );
}

function ImageMockup() {
  const { locale } = useLocale();
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        padding: 16,
        position: 'relative'
      }}
    >
      <div
        style={{
          width: '100%',
          height: 90,
          background: 'linear-gradient(135deg, rgba(139, 111, 248, 0.3), rgba(245, 158, 11, 0.25))',
          borderRadius: 8,
          border: '1px solid var(--border)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 14,
          background: 'var(--brand)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(139, 111, 248, 0.4)'
        }}
      >
        {locale === 'vi' ? 'Lưu ảnh vào Mnemonics' : 'Save image to Mnemonics'}
      </div>
    </div>
  );
}

function ScreenshotMockup() {
  const { locale } = useLocale();
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        padding: 12,
        position: 'relative',
        height: 180
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed var(--border-strong)',
          borderRadius: 8,
          position: 'relative'
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '12%',
            top: '20%',
            width: '70%',
            height: '60%',
            border: '2px dashed var(--brand)',
            borderRadius: 6,
            background: 'rgba(139, 111, 248, 0.1)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            background: 'var(--brand)',
            color: '#ffffff',
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 8,
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(139, 111, 248, 0.4)'
          }}
        >
          {locale === 'vi' ? 'Lưu vùng chọn' : 'Save crop'}
        </div>
      </div>
    </div>
  );
}
