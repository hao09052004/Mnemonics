import { SearchZone } from './SearchZone';
import { ContentTypeChipRow } from './ContentTypeChipRow';
import { MemoryCard } from './MemoryCard';
import { CaptureCard } from './CaptureCard';
import { EmptyState } from './EmptyState';
import type { MemoryCardItem } from './MemoryCard';
import type { MemoryLabel } from '../../lib/memory-kind';

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
}

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
}: EverythingViewProps) {
  const submit = () => {
    const trimmed = query.trim();
    if (trimmed && onSearch) onSearch(trimmed);
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
            },
          }}
        />
      </main>
    );
  }

  return (
    <main className="main everything">
      <header className="dashboard-heading">
        <div>
          <h1>Everything</h1>
          <p>Your saved memories in one place.</p>
        </div>
        <span className="memory-count">{items.length} memories</span>
      </header>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SearchZone value={query} onChange={onQueryChange} autoFocus={Boolean(query)} />
      </form>

      <ContentTypeChipRow active={filter} onChange={onFilterChange} />

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
            <MemoryCard key={it.id} item={it} onOpen={() => onOpen(it.id)} />
          ))}
        </div>
      )}
    </main>
  );
}