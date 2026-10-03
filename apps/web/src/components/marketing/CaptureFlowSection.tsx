import { Link } from 'react-router-dom';

/**
 * "Capture without leaving what you're doing."
 *
 * Three sub-scenarios that map to actual extension gestures:
 *   1. Highlight → right-click → Save to Mnemonics
 *   2. Right-click an image → Save image
 *   3. Screenshot → crop → save
 *
 * Each tile is an original mini-mockup (no screenshots copied from
 * anywhere) so the section reads as product documentation rather
 * than marketing.
 */
export function CaptureFlowSection() {
  return (
    <section className="section">
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">Flows</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            Capture without leaving
            <br />
            what you're doing.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Three gestures cover almost every web moment: highlight something you care about,
            right-click an image, or grab a screenshot. Mnemonics handles the rest.
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
            title="Highlight text"
            body="Select any passage on a page. Right-click → Save to Mnemonics. The original source is kept, the quote is extracted, and the right tags appear without you typing them."
            mockup={<HighlightMockup />}
          />
          <FlowTile
            number="02"
            title="Save an image"
            body="Right-click on an image → Save image. Mnemonics stores a local copy, fingerprints where it came from, and surfaces it whenever a related memory is recalled."
            mockup={<ImageMockup />}
          />
          <FlowTile
            number="03"
            title="Crop a screenshot"
            body="Capture the visible tab, drag a rectangle around what matters, save. Screenshots get OCR'd and embedded, so a text search can find them later."
            mockup={<ScreenshotMockup />}
          />
        </div>

        <div style={{ marginTop: 40 }}>
          <Link to="/browser-extension" className="btn btn--ghost btn--lg">
            See all capture gestures →
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
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 360 }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--muted)', fontWeight: 700 }}>{number}</div>
      <div style={{ minHeight: 180 }}>{mockup}</div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{title}</div>
        <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>{body}</p>
      </div>
    </div>
  );
}

function HighlightMockup() {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        position: 'relative'
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
        “The best <Mark /> is the one that disappears.”
      </div>
      <div
        style={{
          position: 'absolute',
          right: 14,
          top: 36,
          background: 'var(--ink)',
          color: '#fff',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 8
        }}
      >
        Save to Mnemonics
      </div>
    </div>
  );
}

function Mark() {
  return (
    <span style={{ background: 'var(--warm-soft)', padding: '0 4px', borderRadius: 4 }}>interface</span>
  );
}

function ImageMockup() {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        position: 'relative'
      }}
    >
      <div
        style={{
          width: '100%',
          height: 90,
          background: 'linear-gradient(135deg, #ede9fe, #fde4cf)',
          borderRadius: 8
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 14,
          background: 'var(--ink)',
          color: '#fff',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 8
        }}
      >
        Save image to Mnemonics
      </div>
    </div>
  );
}

function ScreenshotMockup() {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
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
          background: 'linear-gradient(135deg, #f7f5ef, #fff)',
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
            borderRadius: 6
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            background: 'var(--brand)',
            color: '#fff',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 8,
            fontWeight: 600
          }}
        >
          Save crop
        </div>
      </div>
    </div>
  );
}
