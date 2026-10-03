import { Link } from 'react-router-dom';

export function Footer() {
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
            <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden>
              <circle cx="14" cy="14" r="14" fill="#5b3fe4" />
              <path d="M9 7 H19 V22 L14 18 L9 22 Z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
              <text x="14" y="17" fontFamily="system-ui" fontSize="8" fontWeight={800} fill="#fff" textAnchor="middle">M</text>
            </svg>
            Mnemonics
          </div>
          <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 14, maxWidth: 36 + 'ch', lineHeight: 1.55 }}>
            Save once. Remember anytime. A personal second brain for the browser-first generation.
          </p>
        </div>

        <FooterColumn
          title="Product"
          items={[
            { label: 'Browser extension', to: '/browser-extension' },
            { label: 'Privacy', to: '/#privacy' },
            { label: 'How it works', to: '/#how' }
          ]}
        />
        <FooterColumn
          title="Account"
          items={[
            { label: 'Log in', to: '/login' },
            { label: 'Create account', to: '/signup' },
            { label: 'Open dashboard', to: '/app' }
          ]}
        />
        <FooterColumn
          title="Resources"
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
        <span>© {new Date().getFullYear()} Mnemonics. All rights reserved.</span>
        <span>Built privately, for one mind at a time.</span>
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
