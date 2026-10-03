import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { InstallExtensionButton } from '../extension/InstallExtensionButton';

/**
 * Hero section.
 *
 * The visual is a stack of composable "memory cards" that drift very
 * subtly with the cursor on desktop. We deliberately avoid any 3rd-party
 * parallax library — the motion is a single rAF loop on a single
 * transform, which is well under any meaningful perf budget.
 *
 * On `prefers-reduced-motion: reduce` the cards stay still.
 */
export function Hero() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [drift, setDrift] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const el = sceneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / rect.width;
      const dy = (e.clientY - cy) / rect.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setDrift({ x: dx, y: dy }));
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <section
      id="product"
      className="section"
      style={{ position: 'relative', paddingTop: 80, paddingBottom: 100 }}
    >
      <div
        className="container"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
          gap: 56,
          alignItems: 'center'
        }}
      >
        <div className="mnemonics-hero-copy">
          <div className="eyebrow">Your second brain</div>
          <h1 className="display h1" style={{ marginTop: 14 }}>
            Remember everything,
            <br />
            without organising everything.
          </h1>
          <p className="lead" style={{ marginTop: 22 }}>
            Mnemonics captures pages, thoughts, images and highlights — then quietly
            connects them so you can find them later by meaning, not by filename.
          </p>

          <div style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <InstallExtensionButton size="lg" />
            <Link to="/app" className="btn btn--ghost btn--lg">
              Open the web app →
            </Link>
          </div>
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
            Chrome · Brave · Edge · Chromium-based browsers
          </div>
        </div>

        <div
          ref={sceneRef}
          aria-hidden="true"
          className="mnemonics-hero-scene"
          style={{
            position: 'relative',
            height: 460,
            perspective: 1000
          }}
        >
          <HeroScene drift={drift} />
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .mnemonics-hero-copy { order: 1; }
          .mnemonics-hero-scene { display: none; }
        }
      `}</style>
    </section>
  );
}

interface SceneProps {
  drift: { x: number; y: number };
}

function HeroScene({ drift }: SceneProps) {
  // Each card is offset + rotated. The drift is a tiny per-axis nudge
  // (max ~8px), so even with all four cards moving the cost is one
  // transform-style change per frame.
  const tx = drift.x * 8;
  const ty = drift.y * 6;

  return (
    <>
      <div style={cardStyle(60, 40, 0, tx, ty)}>
        <ArticleCard />
      </div>
      <div style={cardStyle(280, 80, -6, tx * 0.8, ty * 0.8)}>
        <QuoteCard />
      </div>
      <div style={cardStyle(40, 240, 4, -tx * 0.6, -ty * 0.6)}>
        <ScreenshotCard />
      </div>
      <div style={cardStyle(290, 270, 2, tx * 0.5, -ty * 0.5)}>
        <TagBubble />
      </div>
      <div style={cardStyle(160, 340, 0, -tx, ty * 0.4)}>
        <SearchResultCard />
      </div>
    </>
  );
}

function cardStyle(x: number, y: number, rot: number, tx: number, ty: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    transform: `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg)`,
    willChange: 'transform'
  };
}

function ArticleCard() {
  return (
    <div
      style={{
        width: 220,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 14,
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <div style={{ height: 96, background: 'linear-gradient(135deg, #ede9fe, #fde4cf)', borderRadius: 10 }} />
      <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>The quiet rise of personal AI</div>
      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>theverge.com · 6 min read</div>
    </div>
  );
}

function QuoteCard() {
  return (
    <div
      style={{
        width: 240,
        background: 'var(--ink)',
        color: '#fff',
        borderRadius: 16,
        padding: 16,
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
        Highlight
      </div>
      <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--font-display)' }}>
        “The best interface is the one that disappears.”
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>— Naoto Fukasawa</div>
    </div>
  );
}

function ScreenshotCard() {
  return (
    <div
      style={{
        width: 200,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 12,
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <div style={{ height: 70, background: 'linear-gradient(135deg, #fde4cf, #fff)', borderRadius: 8 }} />
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>Screenshot · cropped</div>
    </div>
  );
}

function TagBubble() {
  const tags = ['design', 'long-form', 'AI', 'craft'];
  return (
    <div
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: 12,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 999
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'var(--brand-tint)',
            color: 'var(--brand)',
            fontWeight: 600
          }}
        >
          #{t}
        </span>
      ))}
    </div>
  );
}

function SearchResultCard() {
  return (
    <div
      style={{
        width: 280,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 14,
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Semantic match</div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>
        “the article about safe reinforcement learning”
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Result title="Concrete Problems in AI Safety" score="0.92" />
        <Result title="Reward Hacking in Deep RL" score="0.81" />
      </div>
    </div>
  );
}

function Result({ title, score }: { title: string; score: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 12,
        color: 'var(--ink-soft)',
        padding: '6px 8px',
        background: 'var(--bg-elevated)',
        borderRadius: 8
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ color: 'var(--brand)', fontWeight: 700 }}>{score}</span>
    </div>
  );
}
