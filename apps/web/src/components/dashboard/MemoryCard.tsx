import { Icon } from './Icons';
import { normalizeKind, type MemoryLabel } from '../../lib/memory-kind';

// Mirrors the BE's `items` shape (subset). Pages convert to this
// before rendering.
export interface MemoryCardItem {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  source_url?: string | null;
  image_url?: string | null;
  selectedText?: string | null;
  tags?: string[];
  captured_at?: string | null;
  is_favorite?: boolean;
  status?: string;
}

interface MemoryCardProps {
  item: MemoryCardItem;
  onOpen?: () => void;
  onToggleFavorite?: () => void;
  relatedCount?: number;
}

const LABEL_EYEBROW: Record<MemoryLabel, string> = {
  note: 'note',
  article: 'article',
  highlight: 'highlight',
  image: 'image',
  screenshot: 'screenshot',
  document: 'document',
};

function isHighlight(item: MemoryCardItem, label: MemoryLabel): boolean {
  if (label === 'highlight') return true;
  // The BE never sends `kind === 'highlight'`; we promote a `link`
  // to the highlight variant when it carries `selectedText`.
  return item.kind === 'link' && Boolean(item.selectedText);
}

export function MemoryCard({
  item,
  onOpen,
  onToggleFavorite,
  relatedCount = 0,
}: MemoryCardProps) {
  const label = normalizeKind(item.kind);
  const highlight = isHighlight(item, label);
  const variantClass = highlight ? 'highlight' : label;
  const hasImage =
    (label === 'image' || label === 'screenshot') && Boolean(item.image_url);
  const sourceLabel = hostnameOf(item.source_url);

  return (
    <article
      data-testid={`item-card-${item.id}`}
      data-type={variantClass}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className={`memory-card ${variantClass}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-card-action]')) return;
        onOpen?.();
      }}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {hasImage && item.image_url ? (
        <div className="card-image">
          <img src={item.image_url} alt={item.title || 'memory image'} loading="lazy" />
        </div>
      ) : null}

      <div className="card-body">
        <div className="card-top">
          <span className="eyebrow">{LABEL_EYEBROW[label]}</span>
          <div className="card-actions">
            {onToggleFavorite ? (
              <button
                type="button"
                aria-label={item.is_favorite ? 'Remove favorite' : 'Add favorite'}
                data-card-action
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
              >
                <Icon name="heart" size={15} />
              </button>
            ) : null}
            <button type="button" aria-label="More actions" data-card-action>
              <Icon name="more" size={16} />
            </button>
          </div>
        </div>

        <h3>{item.title}</h3>
        {!highlight && item.snippet ? <p>{item.snippet}</p> : null}

        <div className="meta">
          <span>{sourceLabel || formatDate(item.captured_at)}</span>
          {item.tags && item.tags.length > 0 ? (
            <span className="tags">{item.tags.slice(0, 3).join(' · ')}</span>
          ) : null}
        </div>

        {relatedCount > 0 ? (
          <div className="related" aria-label={`${relatedCount} related memories`}>
            <i aria-hidden="true" /> {relatedCount} related
          </div>
        ) : null}
      </div>
    </article>
  );
}

function hostnameOf(url?: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}