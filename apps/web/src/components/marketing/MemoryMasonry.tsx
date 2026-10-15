/**
 * "Save anything" — a masonry-ish editorial grid showing the memory
 * types the dashboard already supports. Card sizes are intentionally
 * heterogeneous; this is a memory board, not a feature grid.
 *
 * Sizes map 1:1 to the kinds the API exposes (`link`, `text`, `image`,
 * `screenshot`, `quote`, `file`, `note`). No backend capability is
 * invented here — every type listed exists in `specs/api/capture.md`.
 */
import { useLocale } from '../../lib/locale';

type CardKind = 'link' | 'text' | 'image' | 'screenshot' | 'quote' | 'file' | 'note';

const CARDS: { kind: CardKind; title: string; body: string; tone: string; tag: string; size: 'sm' | 'md' | 'lg' | 'tall' | 'wide' }[] = [
  {
    kind: 'link',
    title: 'The quiet rise of personal AI',
    body: 'a really long article about how small models and personal context are reshaping what we expect from software',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.2), var(--surface))',
    tag: 'theverge.com',
    size: 'tall'
  },
  {
    kind: 'quote',
    title: '“The best interface is the one that disappears.”',
    body: '— Naoto Fukasawa',
    tone: 'var(--surface-hover)',
    tag: 'Highlight',
    size: 'md'
  },
  {
    kind: 'image',
    title: 'Moodboard · brutalist prints',
    body: 'Saved from are.na',
    tone: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), var(--surface))',
    tag: 'Image',
    size: 'wide'
  },
  {
    kind: 'note',
    title: 'Idea — re-entry moments',
    body: 'When a user returns after a long gap, the dashboard should greet them with their most recent cluster rather than chronological.',
    tone: 'var(--surface)',
    tag: 'Quick note',
    size: 'md'
  },
  {
    kind: 'screenshot',
    title: 'Stripe dashboard · settings tree',
    body: 'Captured for future reference',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.15), var(--surface))',
    tag: 'Screenshot',
    size: 'sm'
  },
  {
    kind: 'link',
    title: 'A field guide to personal knowledge systems',
    body: 'Long read on building a second brain without burning out',
    tone: 'var(--surface)',
    tag: 'long-form',
    size: 'sm'
  },
  {
    kind: 'quote',
    title: '“Make the right thing easy.”',
    body: '— A mentor, years ago',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.25), var(--surface))',
    tag: 'Highlight',
    size: 'md'
  },
  {
    kind: 'file',
    title: 'Q3 OKRs — workspace draft',
    body: 'PDF · 12 pages',
    tone: 'var(--surface)',
    tag: 'File',
    size: 'tall'
  },
  {
    kind: 'note',
    title: 'A list of questions I want to ask the team',
    body: 'A scratch pad for one-on-ones',
    tone: 'var(--surface)',
    tag: 'Note',
    size: 'wide'
  }
];

const CARDS_VI: typeof CARDS = [
  {
    kind: 'link',
    title: 'Sự trỗi dậy âm thầm của AI cá nhân',
    body: 'Bài viết sâu sắc về việc các mô hình nhỏ và ngữ cảnh cá nhân đang tái định hình kỳ vọng của chúng ta đối với phần mềm',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.2), var(--surface))',
    tag: 'theverge.com',
    size: 'tall'
  },
  {
    kind: 'quote',
    title: '“Giao diện xuất sắc nhất là giao diện vô hình.”',
    body: '— Naoto Fukasawa',
    tone: 'var(--surface-hover)',
    tag: 'Trích dẫn',
    size: 'md'
  },
  {
    kind: 'image',
    title: 'Moodboard · phong cách brutalist',
    body: 'Lưu từ are.na',
    tone: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), var(--surface))',
    tag: 'Hình ảnh',
    size: 'wide'
  },
  {
    kind: 'note',
    title: 'Ý tưởng — trải nghiệm quay lại',
    body: 'Khi người dùng trở lại sau một khoảng thời gian, dashboard nên chào đón họ bằng các nhóm gần nhất thay vì chỉ theo thứ tự thời gian.',
    tone: 'var(--surface)',
    tag: 'Ghi chú nhanh',
    size: 'md'
  },
  {
    kind: 'screenshot',
    title: 'Bảng điều khiển Stripe · cài đặt',
    body: 'Ảnh chụp màn hình để tra cứu sau',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.15), var(--surface))',
    tag: 'Ảnh màn hình',
    size: 'sm'
  },
  {
    kind: 'link',
    title: 'Cẩm nang xây dựng hệ thống quản lý tri thức',
    body: 'Hướng dẫn xây dựng bộ não thứ hai hiệu quả và bền vững',
    tone: 'var(--surface)',
    tag: 'Bài viết dài',
    size: 'sm'
  },
  {
    kind: 'quote',
    title: '“Hãy biến điều đúng đắn thành điều dễ dàng nhất.”',
    body: '— Lời khuyên từ người thầy',
    tone: 'linear-gradient(135deg, rgba(139, 111, 248, 0.25), var(--surface))',
    tag: 'Trích dẫn',
    size: 'md'
  },
  {
    kind: 'file',
    title: 'Mục tiêu OKR Q3 — bản thảo làm việc',
    body: 'PDF · 12 trang',
    tone: 'var(--surface)',
    tag: 'Tài liệu',
    size: 'tall'
  },
  {
    kind: 'note',
    title: 'Danh sách câu hỏi cần trao đổi với team',
    body: 'Ghi chú chuẩn bị cho buổi họp 1-on-1',
    tone: 'var(--surface)',
    tag: 'Ghi chú',
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
  const { t, locale } = useLocale();
  const activeCards = locale === 'vi' ? CARDS_VI : CARDS;

  return (
    <section className="section" style={{ background: 'var(--bg-elevated)' }}>
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">{t('masonry_eyebrow', 'Save anything')}</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            {t('masonry_headline', 'A memory board, not a folder tree.')}
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            {t('masonry_lead', 'Articles, quotes, screenshots, code snippets, quick notes — Mnemonics keeps them together and lets the connections happen later.')}
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
          {activeCards.map((card, i) => (
            <article
              key={i}
              className="card mn-masonry-card"
              style={{
                breakInside: 'avoid',
                marginBottom: 22,
                padding: 24,
                background: card.tone,
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                minHeight: SIZE_TO_HEIGHT[card.size]
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--brand)',
                  fontWeight: 700
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
                  fontWeight: card.kind === 'quote' ? 500 : 600,
                  color: 'var(--ink)'
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--ink-soft)'
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
