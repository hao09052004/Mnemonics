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
        <Icon name="search" size={20} />
        <input
          aria-label="Search your memories"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          data-mn-search
        />
        <kbd>⌘ K</kbd>
      </div>
    </section>
  );
}