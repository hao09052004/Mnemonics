import { Link } from 'react-router-dom';
import { useLocale } from '../../lib/locale';

export function PrivacySection() {
  const { t } = useLocale();

  return (
    <section id="privacy" className="section" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <div className="container-narrow">
        <div className="eyebrow">{t('privacy_eyebrow', 'Private')}</div>
        <h2 className="display h2" style={{ marginTop: 14 }}>
          {t('privacy_headline', 'Your second brain should feel private.')}
        </h2>
        <p className="lead" style={{ marginTop: 18 }}>
          {t('privacy_lead', "A few things we commit to in this release — and a few things we don't, because shipping them honestly matters more than shipping a bullet list.")}
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
          <Promise
            title={t('privacy_promise_1_title', 'Your data, your account')}
            body={t('privacy_promise_1_body', 'Memories are owned by the user who saved them. There is no public profile, no follower graph, no shared inbox.')}
          />
          <Promise
            title={t('privacy_promise_2_title', 'Captured locally first')}
            body={t('privacy_promise_2_body', 'The extension keeps your last-seen memory state in browser storage so a network hiccup never costs you a save.')}
          />
          <Promise
            title={t('privacy_promise_3_title', 'Direct transport')}
            body={t('privacy_promise_3_body', "The extension talks to the API directly. We don't proxy your captures through any third-party analytics.")}
          />
          <Promise
            title={t('privacy_promise_4_title', 'Audit trail')}
            body={t('privacy_promise_4_body', 'Every API response carries a request id surfaced in error messages so you can ask us exactly what happened.')}
          />
        </ul>

        <div style={{ marginTop: 36 }}>
          <Link to="/login" className="btn btn--ghost">
            {t('privacy_learn_more', 'Learn about privacy →')}
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
          {t(
            'privacy_footnote',
            "We are not currently marketing end-to-end encryption, zero-knowledge storage, or any formal security certification. When those are real, we'll add them here."
          )}
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
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{title}</div>
      <p style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55 }}>{body}</p>
    </li>
  );
}
