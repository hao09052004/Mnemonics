import { Link } from 'react-router-dom';

/**
 * "Your memories, wherever you need them."
 *
 * Honest sync description: extension → API → web dashboard. We
 * explicitly do NOT claim native mobile sync (no mobile build ships
 * today).
 */
export function SyncSection() {
  return (
    <section className="section" style={{ background: 'var(--bg-elevated)' }}>
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">Access</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            Your memories, wherever you need them.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Save from the browser, find it in the dashboard. Mnemonics is a small system with
            a single source of truth: the API.
          </p>
        </div>

        <div
          style={{
            marginTop: 48,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 20
          }}
          className="mnemonics-sync-grid"
        >
          <SyncCard
            label="01"
            title="Browser extension"
            body="Capture from any tab. Highlights, images, screenshots, the whole page."
            icon="🧩"
          />
          <SyncCard
            label="02"
            title="Mnemonics API"
            body="A single REST API processes your memories, runs OCR + tags, and stores vectors."
            icon="⚙️"
          />
          <SyncCard
            label="03"
            title="Web dashboard"
            body="Search, browse and refine. The same library, accessible from any modern browser."
            icon="🖥️"
          />
        </div>

        <div style={{ marginTop: 36, fontSize: 13, color: 'var(--muted)' }}>
          Native iOS / Android sync is on the roadmap. We only list what's shipping today.
          <Link to="/app" style={{ marginLeft: 6, color: 'var(--brand)', fontWeight: 600 }}>
            Open the dashboard →
          </Link>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .mnemonics-sync-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

function SyncCard({ label, title, body, icon }: { label: string; title: string; body: string; icon: string }) {
  return (
    <div
      className="card"
      style={{ padding: 22, minHeight: 200, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
          {label}
        </div>
        <div style={{ fontSize: 20 }} aria-hidden>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>{title}</div>
      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>{body}</p>
    </div>
  );
}
