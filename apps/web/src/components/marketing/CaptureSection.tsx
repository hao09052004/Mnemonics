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

type Phase = 'browse' | 'click' | 'saved' | 'synced';

const PHASES: Phase[] = ['browse', 'click', 'saved', 'synced'];

export function CaptureSection() {
  const [phase, setPhase] = useState<Phase>('browse');

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
          <div className="eyebrow">Capture</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            One click.
            <br />
            Safely remembered.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Click the Mnemonics browser button while you're on a page. We save the article,
            the highlight, the screenshot — whichever you need — without you leaving the tab.
          </p>
          <div style={{ marginTop: 28 }}>
            <Link to="/browser-extension" className="btn btn--primary btn--lg">
              Get the browser extension
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
      <div style={{ padding: 22 }}>
        <div style={{ height: 12, width: 60, background: 'var(--brand-tint)', borderRadius: 4 }} />
        <div style={{ height: 22, width: '80%', background: 'var(--ink)', borderRadius: 4, marginTop: 12 }} />
        <div style={{ height: 22, width: '64%', background: 'var(--ink)', borderRadius: 4, marginTop: 8 }} />
        <div style={{ height: 9, width: '92%', background: 'var(--border)', borderRadius: 4, marginTop: 16 }} />
        <div style={{ height: 9, width: '85%', background: 'var(--border)', borderRadius: 4, marginTop: 6 }} />
        <div style={{ height: 9, width: '90%', background: 'var(--border)', borderRadius: 4, marginTop: 6 }} />
        <div style={{ height: 9, width: '50%', background: 'var(--border)', borderRadius: 4, marginTop: 6 }} />
      </div>

      {/* Saved toast */}
      <div
        style={{
          position: 'absolute',
          right: 20,
          top: 64,
          padding: '10px 14px',
          background: 'var(--ink)',
          color: '#fff',
          fontSize: 13,
          borderRadius: 12,
          opacity: phase === 'saved' || phase === 'synced' ? 1 : 0,
          transform: phase === 'saved' || phase === 'synced' ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          pointerEvents: 'none'
        }}
      >
        Saved to Mnemonics ✓
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
