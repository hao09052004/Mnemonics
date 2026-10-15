import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { InstallExtensionButton } from '../extension/InstallExtensionButton';
import { productConfig } from '../../config/product';

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

  const chromeStoreUrl =
    productConfig.chromeExtensionUrl ||
    'https://chromewebstore.google.com/detail/mnemonics-%E2%80%94-ai-smart-book/mhbnjgijpnhjopffmpaoncddgijfghog';

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
      style={{ position: 'relative', paddingTop: 80, paddingBottom: 100, overflow: 'hidden' }}
    >
      {/* Ambient background glow & fine grid texture */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 0
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            right: '0%',
            width: 720,
            height: 560,
            background: 'radial-gradient(circle, rgba(124, 92, 252, 0.18) 0%, rgba(124, 92, 252, 0.04) 55%, transparent 75%)',
            filter: 'blur(50px)',
            borderRadius: '50%'
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-15%',
            left: '-10%',
            width: 600,
            height: 480,
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.10) 0%, rgba(245, 158, 11, 0.02) 50%, transparent 70%)',
            filter: 'blur(60px)',
            borderRadius: '50%'
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 80%)',
            opacity: 0.55
          }}
        />
      </div>

      <div
        className="container"
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
          gap: 56,
          alignItems: 'center'
        }}
      >
        <div className="mnemonics-hero-copy">
          <div style={{ marginBottom: 18 }}>
            <a
              href={chromeStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mn-hero-pill"
              aria-label="Mnemonics is live on the Chrome Web Store"
            >
              <span className="mn-hero-pill-badge">CHROME STORE</span>
              <span className="mn-hero-pill-text">Official extension is now live</span>
              <span className="mn-hero-pill-arrow">→</span>
            </a>
          </div>

          <h1 className="display h1 mn-hero-headline" style={{ marginTop: 0 }}>
            <span className="mn-hero-gradient-text">Remember everything,</span>
            <br />
            without organising everything.
          </h1>
          <p className="lead" style={{ marginTop: 22 }}>
            Mnemonics captures pages, thoughts, images and highlights — then quietly
            connects them so you can find them later by meaning, not by filename.
          </p>

          <div style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <InstallExtensionButton browser="chrome" variant="primary" size="lg" />
            <InstallExtensionButton browser="edge" variant="secondary" size="lg" />
            <Link to="/app" className="btn btn--ghost btn--lg">
              Open the web app →
            </Link>
          </div>
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
            Chrome · Edge · Brave · Chromium-based browsers
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
      className="mn-hero-card"
      style={{
        width: 220,
        background: 'rgba(22, 25, 35, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 16,
        padding: 14,
        boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
      }}
    >
      <div
        style={{
          height: 96,
          background: 'linear-gradient(135deg, rgba(139, 111, 248, 0.35), rgba(245, 158, 11, 0.25))',
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      />
      <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: '#f2f3f5' }}>
        The quiet rise of personal AI
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
        theverge.com · 6 min read
      </div>
    </div>
  );
}

function QuoteCard() {
  return (
    <div
      className="mn-hero-card"
      style={{
        width: 240,
        background: 'rgba(25, 28, 38, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(139, 111, 248, 0.35)',
        color: '#f2f3f5',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brand)', fontWeight: 700 }}>
          Highlight
        </span>
        <span style={{ fontSize: 18, color: 'var(--brand)', opacity: 0.85, lineHeight: 1 }}>“</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--font-serif, serif)', fontStyle: 'italic', color: '#f2f3f5' }}>
        “The best interface is the one that disappears.”
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af' }}>— Naoto Fukasawa</div>
    </div>
  );
}

function ScreenshotCard() {
  return (
    <div
      className="mn-hero-card"
      style={{
        width: 200,
        background: 'rgba(22, 25, 35, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 16,
        padding: 12,
        boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
      }}
    >
      <div
        style={{
          height: 70,
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(139, 111, 248, 0.25))',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      />
      <div style={{ marginTop: 8, fontSize: 11, color: '#d1d5db', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} />
        Screenshot · OCR indexed
      </div>
    </div>
  );
}

function TagBubble() {
  const tags = ['design', 'long-form', 'AI', 'craft'];
  return (
    <div
      className="mn-hero-card"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '10px 14px',
        background: 'rgba(22, 25, 35, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 999,
        boxShadow: '0 10px 28px -4px rgba(0, 0, 0, 0.5)'
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            fontSize: 12,
            padding: '5px 10px',
            borderRadius: 999,
            background: 'rgba(139, 111, 248, 0.14)',
            color: '#c4b5fd',
            fontWeight: 600,
            border: '1px solid rgba(139, 111, 248, 0.25)'
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
      className="mn-hero-card"
      style={{
        width: 280,
        background: 'rgba(22, 25, 35, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 16,
        padding: 14,
        boxShadow: '0 16px 36px -6px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05) inset'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af' }}>
        <span>Semantic match</span>
        <span style={{ fontSize: 10, color: 'var(--brand)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>AI Recall</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: '#f3e8ff' }}>
        “the article about safe reinforcement learning”
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Result title="Concrete Problems in AI Safety" score="98%" />
        <Result title="Reward Hacking in Deep RL" score="91%" />
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
        color: '#e5e7eb',
        padding: '6px 10px',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 8
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ color: '#c084fc', fontWeight: 700, marginLeft: 8 }}>{score}</span>
    </div>
  );
}
