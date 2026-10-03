/**
 * "Save anything" — a masonry-ish editorial grid showing the memory
 * types the dashboard already supports. Card sizes are intentionally
 * heterogeneous; this is a memory board, not a feature grid.
 *
 * Sizes map 1:1 to the kinds the API exposes (`link`, `text`, `image`,
 * `screenshot`, `quote`, `file`, `note`). No backend capability is
 * invented here — every type listed exists in `specs/api/capture.md`.
 */
type CardKind = 'link' | 'text' | 'image' | 'screenshot' | 'quote' | 'file' | 'note';

const CARDS: { kind: CardKind; title: string; body: string; tone: string; tag: string; size: 'sm' | 'md' | 'lg' | 'tall' | 'wide' }[] = [
  {
    kind: 'link',
    title: 'The quiet rise of personal AI',
    body: 'a really long article about how small models and personal context are reshaping what we expect from software',
    tone: 'linear-gradient(135deg, #ede9fe, #fdfcf8)',
    tag: 'theverge.com',
    size: 'tall'
  },
  {
    kind: 'quote',
    title: '“The best interface is the one that disappears.”',
    body: '— Naoto Fukasawa',
    tone: 'var(--ink)',
    tag: 'Highlight',
    size: 'md'
  },
  {
    kind: 'image',
    title: 'Moodboard · brutalist prints',
    body: 'Saved from are.na',
    tone: 'linear-gradient(135deg, #fde4cf, #fff)',
    tag: 'Image',
    size: 'wide'
  },
  {
    kind: 'note',
    title: 'Idea — re-entry moments',
    body: 'When a user returns after a long gap, the dashboard should greet them with their most recent cluster rather than chronological.',
    tone: 'var(--bg-elevated)',
    tag: 'Quick note',
    size: 'md'
  },
  {
    kind: 'screenshot',
    title: 'Stripe dashboard · settings tree',
    body: 'Captured for future reference',
    tone: 'linear-gradient(135deg, #f7f5ef, #ede9fe)',
    tag: 'Screenshot',
    size: 'sm'
  },
  {
    kind: 'link',
    title: 'A field guide to personal knowledge systems',
    body: 'Long read on building a second brain without burning out',
    tone: 'linear-gradient(135deg, #fdfcf8, #fde4cf)',
    tag: 'long-form',
    size: 'sm'
  },
  {
    kind: 'quote',
    title: '“Make the right thing easy.”',
    body: '— A mentor, years ago',
    tone: 'var(--brand)',
    tag: 'Highlight',
    size: 'md'
  },
  {
    kind: 'file',
    title: 'Q3 OKRs — workspace draft',
    body: 'PDF · 12 pages',
    tone: 'linear-gradient(135deg, #fff, #f7f5ef)',
    tag: 'File',
    size: 'tall'
  },
  {
    kind: 'note',
    title: 'A list of questions I want to ask the team',
    body: 'A scratch pad for one-on-ones',
    tone: 'var(--bg-elevated)',
    tag: 'Note',
    size: 'wide'
  }
];

const SIZE_TO_HEIGHT: Record<typeof CARDS[number]['size'], number> = {
  sm: 180,
  md: 240,
  lg: 320,
  tall: 360,
  wide: 200
};

export function MemoryMasonry() {
  return (
    <section className="section" style={{ background: 'var(--bg-elevated)' }}>
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">Save anything</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            A memory board, not a folder tree.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Articles, quotes, screenshots, code snippets, quick notes — Mnemonics keeps them
            together and lets the connections happen later.
          </p>
        </div>

        <div
          style={{
            marginTop: 48,
            columnCount: 3,
            columnGap: 22
          }}
          className="mnemonics-masonry"
        >
          {CARDS.map((card, i) => (
            <article
              key={i}
              className="card"
              style={{
                breakInside: 'avoid',
                marginBottom: 22,
                padding: 18,
                background: card.tone.startsWith('linear') || card.tone.startsWith('var') ? card.tone : 'var(--surface)',
                color: card.tone === 'var(--ink)' || card.tone === 'var(--brand)' ? '#fff' : 'var(--ink)',
                border: '1px solid var(--border)',
                minHeight: SIZE_TO_HEIGHT[card.size]
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  opacity: 0.7
                }}
              >
                {card.tag}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: card.kind === 'quote' ? 'var(--font-display)' : 'var(--font-sans)',
                  fontSize: card.kind === 'quote' ? 22 : 17,
                  lineHeight: 1.35,
                  fontWeight: card.kind === 'quote' ? 500 : 600
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  opacity: 0.78
                }}
              >
                {card.body}
              </div>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) { .mnemonics-masonry { column-count: 2 !important; } }
        @media (max-width: 720px) { .mnemonics-masonry { column-count: 1 !important; } }
      `}</style>
    </section>
  );
}
