import { Icon } from './Icons';
import { useLocale } from '../../lib/locale';

interface SearchZoneProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchZone({
  value,
  onChange,
  placeholder,
  autoFocus,
}: SearchZoneProps) {
  const { t } = useLocale();
  const effectivePlaceholder = placeholder ?? t('search_placeholder', 'Search your memories...');

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
          placeholder={effectivePlaceholder}
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