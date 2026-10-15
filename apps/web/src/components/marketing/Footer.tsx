import { Link } from 'react-router-dom';
import { useLocale } from '../../lib/locale';

export function Footer() {
  const { t } = useLocale();

  return (
    <footer
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: '48px 0 64px'
      }}
    >
      <div
        className="container mnemonics-footer-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) repeat(3, minmax(0, 1fr))',
          gap: 32
        }}
      >
        <div>
          <Link
            to="/"
            onClick={(e) => {
              try {
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                document.documentElement.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
              } catch {
                // no-op in JSDOM / test environments
              }
              if (window.location.pathname === '/') {
                e.preventDefault();
                if (window.location.hash) {
                  window.history.pushState(null, '', '/');
                }
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontWeight: 700,
              color: 'var(--ink)',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            aria-label="Mnemonics home"
          >
            <img
              src="/logo.png"
              alt="Mnemonics"
              width={24}
              height={24}
              style={{ borderRadius: '50%', display: 'block', objectFit: 'contain' }}
            />
            Mnemonics
          </Link>
          <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 14, maxWidth: 36 + 'ch', lineHeight: 1.55 }}>
            {t('footer_slogan', 'Save once. Remember anytime. A personal second brain for the browser-first generation.')}
          </p>
        </div>

        <FooterColumn
          title={t('footer_col_product', 'Product')}
          items={[
            { label: t('nav_extension', 'Browser extension'), to: '/browser-extension' },
            { label: t('nav_privacy', 'Privacy'), to: '/#privacy' },
            { label: t('nav_how_it_works', 'How it works'), to: '/#how' }
          ]}
        />
        <FooterColumn
          title={t('footer_col_account', 'Account')}
          items={[
            { label: t('nav_login', 'Log in'), to: '/login' },
            { label: t('footer_link_create_account', 'Create account'), to: '/signup' },
            { label: t('footer_link_open_dashboard', 'Open dashboard'), to: '/app' }
          ]}
        />
        <FooterColumn
          title={t('footer_col_resources', 'Resources')}
          items={[
            { label: 'GitHub', to: 'https://github.com/hao09052004/Mnemonics' }
          ]}
        />
      </div>

      <div
        className="container"
        style={{
          marginTop: 32,
          paddingTop: 18,
          borderTop: '1px solid var(--border)',
          color: 'var(--muted)',
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <span>© {new Date().getFullYear()} Mnemonics. {t('footer_copyright', 'All rights reserved.')}</span>
        <span>{t('footer_tagline', 'Built privately, for one mind at a time.')}</span>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .mnemonics-footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </footer>
  );
}

function FooterColumn({
  title,
  items
}: {
  title: string;
  items: { label: string; to: string }[];
}) {
  return (
    <div>
      <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
        {title}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
        {items.map((it) => (
          <li key={it.label}>
            {it.to.startsWith('http') ? (
              <a
                href={it.to}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--ink-soft)', fontSize: 14 }}
              >
                {it.label}
              </a>
            ) : (
              <Link to={it.to} style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
                {it.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
