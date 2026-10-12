import { useEffect, useState } from 'react';

/**
 * Animated search demonstration using a fake marketing-only dataset.
 * The real dashboard never sees this — it lives entirely in the
 * marketing component for visual storytelling.
 */
const SAMPLE_QUERY = 'the article about safe reinforcement learning';

const SAMPLE_RESULTS: { title: string; url: string; score: number; matches: string[] }[] = [
  {
    title: 'Concrete Problems in AI Safety',
    url: 'arxiv.org/abs/1606.06565',
    score: 0.93,
    matches: ['AI safety', 'reward modeling']
  },
  {
    title: 'Reward Hacking in Deep RL',
    url: 'deepmind.google/research',
    score: 0.86,
    matches: ['reinforcement learning', 'alignment']
  },
  {
    title: 'Specifying Safety in Reinforcement Learning',
    url: 'people.eecs.berkeley.edu',
    score: 0.81,
    matches: ['safe RL', 'constraints']
  },
  {
    title: 'Notes on AGI Risk (personal)',
    url: 'notebook · 2025-08-12',
    score: 0.74,
    matches: ['AI risk', 'long-term']
  }
];

export function SemanticSearchDemo() {
  const [typed, setTyped] = useState('');
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(SAMPLE_QUERY);
      setShowResults(true);
      return;
    }

    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      setTyped(SAMPLE_QUERY.slice(0, i));
      i += 1;
      if (i <= SAMPLE_QUERY.length) {
        window.setTimeout(tick, 38);
      } else {
        window.setTimeout(() => !cancelled && setShowResults(true), 240);
      }
    };
    const t = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  return (
    <section className="section" style={{ background: 'var(--bg-elevated)' }}>
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">Recall</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            Search the way you remember.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Type it the way you'd ask a friend. Mnemonics finds it by meaning, not by the words
            that happened to be in the title.
          </p>
        </div>

        <div
          className="card"
          style={{
            marginTop: 40,
            padding: 24,
            background: 'var(--surface)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 16px',
              border: '1px solid var(--border)',
              borderRadius: 14,
              background: 'var(--bg-elevated)'
            }}
          >
            <SearchIcon />
            <span style={{ fontSize: 15, color: 'var(--ink-soft)', minHeight: 20 }}>
              {typed}
              <span style={{ display: 'inline-block', width: 1, height: 16, background: 'var(--brand)', marginLeft: 2, verticalAlign: 'middle' }} />
            </span>
          </div>

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '18px 0 0',
              display: 'grid',
              gap: 10,
              opacity: showResults ? 1 : 0,
              transform: showResults ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.4s ease, transform 0.4s ease'
            }}
            data-testid="search-results"
          >
            {SAMPLE_RESULTS.map((r) => (
              <li
                key={r.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '14px 16px',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  background: 'var(--surface)'
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{r.url}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {r.matches.map((m) => (
                      <span
                        key={m}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 999,
                          background: 'var(--brand-tint)',
                          color: 'var(--brand)',
                          fontWeight: 600
                        }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ minWidth: 56, textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--brand)',
                      fontFamily: 'var(--font-display)'
                    }}
                  >
                    {r.score.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    match
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="8" cy="8" r="5" />
      <path d="m13 13 3 3" strokeLinecap="round" />
    </svg>
  );
}
