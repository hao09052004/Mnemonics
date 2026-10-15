/**
 * "One click. Safely remembered." section.
 *
 * An animated conceptual browser mockup that progresses through
 *   1. User on a real-looking article page
 *   2. Clicks the Mnemonics extension icon
 *   3. Extension shows the saved confirmation
 *   4. Memory card flies into the dashboard list
 *
 * The loop runs on a 6-second cycle and pauses for users with
 * `prefers-reduced-motion: reduce`.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../lib/locale';

type Phase = 'browse' | 'click' | 'saved' | 'synced';

const PHASES: Phase[] = ['browse', 'click', 'saved', 'synced'];

export function CaptureSection() {
  const [phase, setPhase] = useState<Phase>('browse');
  const { t } = useLocale();

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setPhase('saved');
      return;
    }
    let i = 0;
    const t = window.setInterval(() => {
      i = (i + 1) % PHASES.length;
      setPhase(PHASES[i]);
    }, 1600);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section id="how" className="section section--tight" style={{ background: 'var(--bg-elevated)' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 56, alignItems: 'center' }}>
        <div>
          <div className="eyebrow">{t('capture_eyebrow', 'Capture')}</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            {t('capture_headline_1', 'One click.')}
            <br />
            {t('capture_headline_2', 'Safely remembered.')}
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            {t('capture_lead', "Click the Mnemonics browser button while you're on a page. We save the article, the highlight, the screenshot — whichever you need — without you leaving the tab.")}
          </p>
          <div style={{ marginTop: 28 }}>
            <Link to="/browser-extension" className="btn btn--primary btn--lg">
              {t('capture_btn_install', 'Get the browser extension')}
            </Link>
          </div>
        </div>

        <BrowserMockup phase={phase} />
      </div>

      <style>{`
        @media (max-width: 860px) {
          #how .container { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

function BrowserMockup({ phase }: { phase: Phase }) {
  const { t, locale } = useLocale();

  return (
    <div
      data-testid="capture-mockup"
      data-phase={phase}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden'
      }}
    >
      {/* Browser chrome */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)'
        }}
      >
        <Dot color="#ff5f57" />
        <Dot color="#febc2e" />
        <Dot color="#28c840" />
        <div
          style={{
            flex: 1,
            height: 26,
            borderRadius: 6,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontSize: 12,
            color: 'var(--muted)'
          }}
        >
          theverge.com/quiet-rise-of-personal-ai
        </div>
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: phase === 'click' || phase === 'saved' || phase === 'synced' ? 'var(--brand)' : 'transparent',
            border: '1px solid var(--border)',
            transition: 'background 0.3s ease',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 14
          }}
          data-testid="extension-icon"
        >
          {phase === 'saved' || phase === 'synced' ? '✓' : 'M'}
        </div>
      </div>

      {/* Page body */}
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', width: 'fit-content', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brand)', background: 'var(--brand-soft)', padding: '3px 8px', borderRadius: 6 }}>
          {locale === 'vi' ? 'Công nghệ • Đọc 6 phút' : 'Tech • 6 min read'}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.35, marginTop: 4 }}>
          {locale === 'vi' ? 'Sự trỗi dậy âm thầm của AI cá nhân' : 'The quiet rise of personal AI'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          {locale === 'vi'
            ? 'Cách tiện ích bộ não thứ hai thông minh âm thầm thay đổi cách chúng ta thu thập và nhớ lại tri thức trên web.'
            : 'How intelligent second-brain extensions quietly change the way we capture and recall knowledge across the web.'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--muted)', border: '1px solid var(--border)' }}>#ai</span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--muted)', border: '1px solid var(--border)' }}>#knowledge</span>
        </div>
      </div>

      {/* Saved toast */}
      <div
        style={{
          position: 'absolute',
          right: 20,
          top: 64,
          padding: '10px 14px',
          background: 'var(--brand)',
          color: '#ffffff',
          fontWeight: 600,
          boxShadow: '0 4px 16px rgba(139, 111, 248, 0.4)',
          fontSize: 13,
          borderRadius: 12,
          opacity: phase === 'saved' || phase === 'synced' ? 1 : 0,
          transform: phase === 'saved' || phase === 'synced' ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          pointerEvents: 'none'
        }}
      >
        {locale === 'vi' ? 'Đã lưu vào Mnemonics ✓' : 'Saved to Mnemonics ✓'}
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: color,
        display: 'inline-block'
      }}
    />
  );
}
