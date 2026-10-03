import { Link } from 'react-router-dom';

/**
 * "Your second brain should feel private."
 *
 * Only the privacy properties the current implementation actually
 * provides. We deliberately do NOT claim:
 *   - end-to-end encryption
 *   - zero-knowledge encryption
 *   - SOC 2 / GDPR certification (none claimed at this stage)
 *   - data-on-device-only (the dashboard requires an account)
 */
export function PrivacySection() {
  return (
    <section id="privacy" className="section" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <div className="container-narrow">
        <div className="eyebrow">Private</div>
        <h2 className="display h2" style={{ marginTop: 14 }}>
          Your second brain should feel private.
        </h2>
        <p className="lead" style={{ marginTop: 18 }}>
          A few things we commit to in this release — and a few things we don't, because
          shipping them honestly matters more than shipping a bullet list.
        </p>

        <ul
          style={{
            marginTop: 32,
            padding: 0,
            listStyle: 'none',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 18
          }}
        >
          <Promise title="Your data, your account" body="Memories are owned by the user who saved them. There is no public profile, no follower graph, no shared inbox." />
          <Promise title="Captured locally first" body="The extension keeps your last-seen memory state in browser storage so a network hiccup never costs you a save." />
          <Promise title="Direct transport" body="The extension talks to the API directly. We don't proxy your captures through any third-party analytics." />
          <Promise title="Audit trail" body="Every API response carries a request id surfaced in error messages so you can ask us exactly what happened." />
        </ul>

        <div style={{ marginTop: 36 }}>
          <Link to="/login" className="btn btn--ghost">
            Learn about privacy →
          </Link>
        </div>

        <p
          style={{
            marginTop: 32,
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: 56 + 'ch'
          }}
        >
          We are not currently marketing end-to-end encryption, zero-knowledge storage, or any
          formal security certification. When those are real, we'll add them here.
        </p>
      </div>
    </section>
  );
}

function Promise({ title, body }: { title: string; body: string }) {
  return (
    <li
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 18
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
      <p style={{ marginTop: 8, color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>{body}</p>
    </li>
  );
}
