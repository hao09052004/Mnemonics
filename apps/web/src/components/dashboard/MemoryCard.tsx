import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import { normalizeKind, type MemoryLabel } from '../../lib/memory-kind';
import '../spaces/spaces.css';

// Mirrors the BE's `items` shape (subset). Pages convert to this
// before rendering.
export interface MemoryCardItem {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  source_url?: string | null;
  image_url?: string | null;
  /** Raw body text, used to decide the `highlight` variant. */
  selectedText?: string | null;
  tags?: string[];
  captured_at?: string | null;
  is_favorite?: boolean;
  status?: string;
  /** `document`-only. Surfaced on the card as "PDF · 12 pages". */
  page_count?: number | null;
  /** Pre-built asset blob for document cards (mime type, size, filename). */
  asset?: { mime_type?: string | null; size_bytes?: number | null; original_filename?: string | null } | null;
  /** M7 — present only when SEARCH_EXPLAINABILITY_ENABLED=true. Renders
   *  as a "Why this matched" pill below the snippet. */
  explanation?: {
    lexical: number;
    vector: number;
    chunk: number;
    rrf: number;
    rerank: number | null;
  };
}

interface MemoryCardProps {
  item: MemoryCardItem;
  onOpen?: () => void;
  onToggleFavorite?: () => void;
  /** Called after the user confirms. Omit to hide the button. */
  onDelete?: () => void;
  /** Disables the button while the DELETE request is in flight. */
  deleting?: boolean;
  /** Disables the heart while the PATCH request is in flight. */
  favoriting?: boolean;
  /** Used by the "..." menu to open the detail view. */
  onOpenDetail?: () => void;
  relatedCount?: number;
  /**
   * Selection mode. When `selected` is defined the card shows a
   * checkbox and a click toggles membership instead of opening the
   * memory — bulk actions and navigation are mutually exclusive, and
   * making the user hold a modifier to disambiguate would be worse
   * than hiding the open action entirely.
   */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Renders the "Add to Space" entry in the "..." menu. */
  onAddToSpace?: () => void;
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
  onDelete,
  deleting = false,
  favoriting = false,
  onOpenDetail,
  relatedCount = 0,
  selected,
  onToggleSelect,
  onAddToSpace
}: MemoryCardProps) {
  const label = normalizeKind(item.kind);
  const highlight = isHighlight(item, label);
  const variantClass = highlight ? 'highlight' : label;
  const hasImage =
    (label === 'image' || label === 'screenshot') && Boolean(item.image_url);
  const sourceLabel = hostnameOf(item.source_url);
  const selecting = onToggleSelect !== undefined;

  // The "..." overflow menu. Kept local to the card: only one menu can
  // plausibly be open at a time, and a shared store would add ceremony
  // for no benefit.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <article
      data-testid={`item-card-${item.id}`}
      data-type={variantClass}
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected === true : undefined}
      className={
        selecting
          ? `memory-card ${variantClass} is-selectable${selected ? ' is-selected' : ''}`
          : `memory-card ${variantClass}`
      }
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-card-action]')) return;
        if (onToggleSelect) {
          onToggleSelect();
          return;
        }
        onOpen?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onToggleSelect) {
            onToggleSelect();
            return;
          }
          onOpen?.();
        }
      }}
    >
      {selecting ? (
        <span
          className={selected ? 'card-select is-checked' : 'card-select'}
          data-testid={`item-select-${item.id}`}
          aria-hidden="true"
        >
          <Icon name="check" size={13} />
        </span>
      ) : null}

      {hasImage && item.image_url ? (
        <div className="card-image">
          <img src={item.image_url} alt={item.title || 'memory image'} loading="lazy" />
        </div>
      ) : null}

      <div className="card-body">
        <div className="card-top">
          <span className="eyebrow">{LABEL_EYEBROW[label]}</span>
          <div className="card-actions">
            {onToggleFavorite && !selecting ? (
              <button
                type="button"
                aria-label={item.is_favorite ? 'Remove favorite' : 'Add favorite'}
                aria-pressed={item.is_favorite === true}
                data-card-action
                data-testid={`item-favorite-${item.id}`}
                disabled={favoriting}
                className={item.is_favorite ? 'is-favorite' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
              >
                <Icon
                  name="heart"
                  size={15}
                  // A filled heart is the only reliable "already
                  // favorited" signal at 15px; colour alone is not.
                  filled={item.is_favorite === true}
                />
              </button>
            ) : null}

            <div className="card-menu" ref={menuRef}>
              <button
                type="button"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                data-card-action
                data-testid={`item-more-${item.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <Icon name="more" size={16} />
              </button>

              {menuOpen ? (
                <div className="card-menu-pop" role="menu">
                  {onOpenDetail ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-card-action
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onOpenDetail();
                      }}
                    >
                      <Icon name="arrow" size={14} />
                      Open details
                    </button>
                  ) : null}
                  {onToggleFavorite ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-card-action
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onToggleFavorite();
                      }}
                    >
                      <Icon name="heart" size={14} filled={item.is_favorite === true} />
                      {item.is_favorite ? 'Remove favorite' : 'Add favorite'}
                    </button>
                  ) : null}
                  {onAddToSpace ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-card-action
                      data-testid={`item-menu-add-to-space-${item.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onAddToSpace();
                      }}
                    >
                      <Icon name="plus" size={14} />
                      Add to Space
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-card-action
                      data-testid={`item-menu-delete-${item.id}`}
                      disabled={deleting}
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onDelete();
                      }}
                    >
                      <Icon name="trash" size={14} />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <h3>{item.title}</h3>
        {label === 'document' ? <DocumentMeta item={item} /> : null}
        {item.snippet ? <p>{item.snippet}</p> : null}

        {item.explanation ? <ExplainabilityPill explanation={item.explanation} /> : null}

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

/**
 * Document-specific subtitle row. Examples:
 *   PDF · 18 pages · 2.4 MB
 *   TXT · 12 KB
 *   Markdown · 4 KB
 *
 * While the item is still being processed the row collapses to
 * "Processing document…" so the user isn't shown "PDF · 0 pages · 0 B".
 */
function DocumentMeta({ item }: { item: MemoryCardItem }) {
  const mime = item.asset?.mime_type ?? null;
  const sizeBytes = item.asset?.size_bytes ?? null;
  const pageCount = item.page_count ?? null;

  const isProcessing = item.status === 'pending' || item.status === 'processing';
  if (isProcessing) {
    return (
      <p className="card-meta-document" data-testid={`item-status-${item.id}`}>
        Processing document…
      </p>
    );
  }

  const parts: string[] = [];
  if (mime === 'application/pdf') parts.push('PDF');
  else if (mime === 'text/plain') parts.push('TXT');
  else if (mime === 'text/markdown') parts.push('Markdown');
  if (pageCount && pageCount > 0) parts.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
  if (sizeBytes && sizeBytes > 0) parts.push(formatBytes(sizeBytes));

  if (parts.length === 0) return null;
  return (
    <p className="card-meta-document" data-testid={`item-document-meta-${item.id}`}>
      {parts.join(' · ')}
    </p>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface ExplainabilityPillProps {
  explanation: {
    lexical: number;
    vector: number;
    chunk: number;
    rrf: number;
    rerank: number | null;
  };
}

/**
 * M7 — "Why this matched" pill. Renders a native <details> so
 * focus / hover / tap all work without JS handlers. The table is
 * hidden by default; the summary is the visible string.
 */
function ExplainabilityPill({ explanation }: ExplainabilityPillProps): JSX.Element {
  return (
    <details className="memory-card-explainability" data-testid="memory-card-explainability">
      <summary>Why this matched</summary>
      <table>
        <tbody>
          <tr><th>Lexical</th><td>{explanation.lexical.toFixed(4)}</td></tr>
          <tr><th>Vector</th><td>{explanation.vector.toFixed(4)}</td></tr>
          <tr><th>Chunk</th><td>{explanation.chunk.toFixed(4)}</td></tr>
          <tr><th>RRF</th><td>{explanation.rrf.toFixed(4)}</td></tr>
          <tr><th>Re-rank</th><td>{explanation.rerank === null ? '—' : explanation.rerank.toFixed(4)}</td></tr>
        </tbody>
      </table>
    </details>
  );
}