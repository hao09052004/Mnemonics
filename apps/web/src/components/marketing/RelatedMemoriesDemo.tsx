/**
 * "One memory leads to another." — visualises the existing
 * related-memories feature. One centre card, three related cards
 * connected with subtle lines.
 */
const CENTRE = {
  title: 'Calm interfaces and the case for less',
  tag: 'Essay',
  excerpt: 'Why the most-loved products of the next decade will be the ones that ask for less of your attention.'
};

const RELATED = [
  { title: 'Naoto Fukasawa — without thought', tag: 'Highlight', tilt: -4 },
  { title: 'Field notes: friction as a feature', tag: 'Personal note', tilt: 3 },
  { title: 'Aesthetics of slow software', tag: 'Article', tilt: -2 }
];

const CENTRE_VI = {
  title: 'Giao diện tĩnh lặng và triết lý tối giản',
  tag: 'Tiểu luận',
  excerpt: 'Vì sao những sản phẩm được yêu thích nhất thập kỷ tới sẽ là những ứng dụng ít đòi hỏi sự chú ý nhất.'
};

const RELATED_VI = [
  { title: 'Naoto Fukasawa — Tư duy trực giác', tag: 'Điểm nhấn', tilt: -4 },
  { title: 'Ghi chú thực địa: Ma sát như một tính năng', tag: 'Ghi chú', tilt: 3 },
  { title: 'Thẩm mỹ của phần mềm tĩnh tại', tag: 'Bài viết', tilt: -2 }
];

import { useLocale } from '../../lib/locale';

export function RelatedMemoriesDemo() {
  const { locale, t } = useLocale();
  const centre = locale === 'vi' ? CENTRE_VI : CENTRE;
  const related = locale === 'vi' ? RELATED_VI : RELATED;

  return (
    <section className="section">
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">{t('related_eyebrow', 'Connect')}</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            {t('related_headline', 'One memory leads to another.')}
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            {t('related_lead', 'Save enough, and Mnemonics starts surfacing unexpected connections. Related memories appear inline so a single save can become the start of a long thread.')}
          </p>
        </div>

        <div
          style={{
            marginTop: 56,
            display: 'grid',
            placeItems: 'center',
            minHeight: 460,
            position: 'relative'
          }}
        >
          {/* Connector lines */}
          <svg
            aria-hidden
            width="100%"
            height="100%"
            viewBox="0 0 600 460"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <line x1="300" y1="230" x2="80" y2="80" stroke="var(--brand)" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <line x1="300" y1="230" x2="540" y2="80" stroke="var(--brand)" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <line x1="300" y1="230" x2="300" y2="420" stroke="var(--brand)" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
          </svg>

          <RelatedCard
            title={centre.title}
            tag={centre.tag}
            excerpt={centre.excerpt}
            size="lg"
            style={{ gridArea: '1 / 1' }}
          />

          {related.map((r, i) => {
            const positionStyles: React.CSSProperties[] = [
              { position: 'absolute', top: 20, left: 20, transform: `rotate(${r.tilt}deg)` },
              { position: 'absolute', top: 20, right: 20, transform: `rotate(${r.tilt}deg)` },
              { position: 'absolute', bottom: 20, left: '50%', translate: '-50% 0', transform: `rotate(${r.tilt}deg)` }
            ];
            return (
              <div key={r.title} style={positionStyles[i]}>
                <RelatedCard title={r.title} tag={r.tag} excerpt="" size="sm" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RelatedCard({
  title,
  tag,
  excerpt,
  size,
  style
}: {
  title: string;
  tag: string;
  excerpt: string;
  size: 'sm' | 'lg';
  style?: React.CSSProperties;
}) {
  const isLg = size === 'lg';
  return (
    <div
      style={{
        width: isLg ? 320 : 220,
        padding: isLg ? 20 : 14,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        boxShadow: isLg ? 'var(--shadow-lg)' : 'var(--shadow-md)',
        ...style
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brand)', fontWeight: 700 }}>
        {tag}
      </div>
      <div style={{ marginTop: 10, fontFamily: 'var(--font-display)', fontSize: isLg ? 22 : 15, lineHeight: 1.3, color: 'var(--ink)', fontWeight: 600 }}>
        {title}
      </div>
      {excerpt && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{excerpt}</div>
      )}
    </div>
  );
}
