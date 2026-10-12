import type { MemoryLabel } from '../../lib/memory-kind';

interface Props {
  active: MemoryLabel | 'all';
  onChange: (label: MemoryLabel | 'all') => void;
}

const LABELS: Array<{ id: MemoryLabel | 'all'; name: string }> = [
  { id: 'all', name: 'All' },
  { id: 'note', name: 'Notes' },
  { id: 'article', name: 'Articles' },
  { id: 'image', name: 'Images' },
  { id: 'screenshot', name: 'Screenshots' },
  { id: 'highlight', name: 'Highlights' },
  { id: 'document', name: 'Documents' },
];

export function ContentTypeChipRow({ active, onChange }: Props) {
  return (
    <div className="filter-row">
      <div className="chips" aria-label="Content type">
        {LABELS.map((label) => (
          <button
            key={label.id}
            type="button"
            aria-pressed={active === label.id}
            onClick={() => onChange(label.id)}
            className={`chip ${active === label.id ? 'active' : ''}`}
          >
            {label.name}
          </button>
        ))}
      </div>
    </div>
  );
}