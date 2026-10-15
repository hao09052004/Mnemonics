import { Icon } from './Icons';

interface SearchZoneProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchZone({
  value,
  onChange,
  placeholder = 'Search your memories...',
  autoFocus,
}: SearchZoneProps) {
  return (
    <section className="search-zone" aria-label="Memory search">
      <div className="searchline">
        <span className="search-icon-wrap" aria-hidden="true">
          <Icon name="search" size={19} />
        </span>
        <input
          aria-label="Search your memories"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          data-mn-search
        />
        {value ? (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => onChange('')}
            aria-label="Clear search"
            data-testid="search-clear"
          >
            <Icon name="x" size={14} />
          </button>
        ) : (
          <kbd className="search-kbd">⌘ K</kbd>
        )}
      </div>
    </section>
  );
}