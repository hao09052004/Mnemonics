import { useState } from 'react';
import { SearchZone } from './SearchZone';
import { ContentTypeChipRow } from './ContentTypeChipRow';
import { MemoryCard } from './MemoryCard';
import { CaptureCard } from './CaptureCard';
import { EmptyState } from './EmptyState';
import { Icon } from './Icons';
import type { MemoryCardItem } from './MemoryCard';
import type { MemoryLabel } from '../../lib/memory-kind';
import '../spaces/spaces.css';

interface EverythingViewProps {
  items: MemoryCardItem[];
  loading: boolean;
  error?: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSearch?: (q: string) => void;
  filter: MemoryLabel | 'all';
  onFilterChange: (f: MemoryLabel | 'all') => void;
  onOpen: (id: string) => void;
  onCapture: () => void;
  /** Called with the item id when a delete is requested. */
  onDelete?: (id: string) => void;
  /** Ids currently being deleted, so their buttons can disable. */
  deletingIds?: ReadonlySet<string>;
  /** Called with the item id to flip `items.is_favorite`. */
  onToggleFavorite?: (id: string) => void;
  /** Ids currently being favorited, so their hearts can disable. */
  favoritingIds?: ReadonlySet<string>;
  /**
   * Multi-select. Omit to hide the affordance entirely (a Space
   * detail page, for instance, needs no bulk grouping).
   */
  onAddToSpace?: (itemIds: string[]) => void;
  /**
   * Hide "Add to Space" in the per-card menu. Set on Space detail
   * pages, where the memory is already in a Space.
   */
  hideCardAddToSpace?: boolean;
  /** Right-hand slot, used by Space detail to render rule chips. */
  children?: React.ReactNode;
}

/**
 * The Everything grid.
 *
 * Selection is opt-in per instance rather than global state: entering
 * it from a card menu and from a toolbar are different intents, and a
 * shared mode would leave the user stuck in a mode they cannot leave.
 */
export function EverythingView({
  items,
  loading,
  error,
  query,
  onQueryChange,
  onSearch,
  filter,
  onFilterChange,
  onOpen,
  onCapture,
  onDelete,
  deletingIds,
  onToggleFavorite,
  favoritingIds,
  onAddToSpace,
  hideCardAddToSpace,
  children
}: EverythingViewProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  if (error === 'TOKEN_EXPIRED') {
    return (
      <main className="main everything">
        <EmptyState
          title="Session expired"
          text="Please sign in again to continue."
          action={{
            label: 'Sign in',
            onClick: () => {
              window.location.href = '/login';
            }
          }}
        />
      </main>
    );
  }

  const selectedIds = Array.from(selected);

  return (
    <main className="main everything">
      <header className="dashboard-heading">
        <div>
          <h1>Everything</h1>
          <p>Your saved memories in one place.</p>
        </div>
        <span className="memory-count">{items.length} memories</span>
      </header>

      {selectMode ? (
        <div className="selection-bar" data-testid="selection-bar">
          <span className="selection-bar__count" data-testid="selection-count">
            {selectedIds.length} {selectedIds.length === 1 ? 'memory' : 'memories'} selected
          </span>
          <span className="selection-bar__spacer" />
          {onAddToSpace ? (
            <button
              type="button"
              data-testid="selection-add-to-space"
              disabled={selectedIds.length === 0}
              onClick={() => onAddToSpace(selectedIds)}
            >
              <Icon name="plus" size={13} /> Add to Space
            </button>
          ) : null}
          <button
            type="button"
            data-testid="selection-cancel"
            onClick={exitSelection}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = query.trim();
          if (trimmed && onSearch) onSearch(trimmed);
        }}
      >
        <SearchZone value={query} onChange={onQueryChange} autoFocus={Boolean(query)} />
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ContentTypeChipRow active={filter} onChange={onFilterChange} />
        <span style={{ flex: 1 }} />
        {children}
        {onAddToSpace && !selectMode ? (
          <button
            type="button"
            data-testid="enter-selection"
            onClick={() => setSelectMode(true)}
            style={{
              font: 'inherit',
              fontSize: 'var(--mn-fs-meta)',
              color: 'var(--mn-text-2)',
              background: 'none',
              border: '1px solid var(--mn-border-strong)',
              borderRadius: 'var(--mn-r-xs)',
              padding: '5px 10px',
              cursor: 'pointer'
            }}
          >
            Select
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="masonry" aria-busy>
          {[220, 168, 244, 312, 220, 168].map((h, i) => (
            <div
              key={i}
              className={`skeleton ${h >= 300 ? 'tall' : h >= 220 ? 'medium' : 'short'}`}
              style={{ height: h }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={query ? 'No memories found.' : 'Your memory starts here.'}
          text={
            query
              ? 'Try another keyword or a different content type.'
              : 'Save something worth remembering.'
          }
          action={query ? undefined : { label: 'Capture', onClick: onCapture }}
        />
      ) : (
        <div className="masonry">
          {!query ? <CaptureCard onClick={onCapture} /> : null}
          {items.map((it) => (
            <MemoryCard
              key={it.id}
              item={it}
              selected={selected.has(it.id)}
              onToggleSelect={selectMode ? () => toggle(it.id) : undefined}
              onOpen={selectMode ? undefined : () => onOpen(it.id)}
              onDelete={onDelete ? () => onDelete(it.id) : undefined}
              deleting={deletingIds?.has(it.id) ?? false}
              onToggleFavorite={
                onToggleFavorite ? () => onToggleFavorite(it.id) : undefined
              }
              favoriting={favoritingIds?.has(it.id) ?? false}
              onOpenDetail={() => onOpen(it.id)}
              onAddToSpace={
                hideCardAddToSpace || !onAddToSpace
                  ? undefined
                  : () => onAddToSpace([it.id])
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}
