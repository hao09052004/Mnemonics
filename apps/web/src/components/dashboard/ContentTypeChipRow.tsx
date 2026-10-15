import type { MemoryLabel } from '../../lib/memory-kind';
import { useLocale } from '../../lib/locale';

interface Props {
  active: MemoryLabel | 'all';
  onChange: (label: MemoryLabel | 'all') => void;
}

const LABELS: Array<{ id: MemoryLabel | 'all'; name: string; key: string }> = [
  { id: 'all', name: 'All', key: 'chip_all' },
  { id: 'note', name: 'Notes', key: 'chip_note' },
  { id: 'article', name: 'Articles', key: 'chip_article' },
  { id: 'image', name: 'Images', key: 'chip_image' },
  { id: 'screenshot', name: 'Screenshots', key: 'chip_screenshot' },
  { id: 'highlight', name: 'Highlights', key: 'chip_highlight' },
  { id: 'document', name: 'Documents', key: 'chip_document' },
];

export function ContentTypeChipRow({ active, onChange }: Props) {
  const { t } = useLocale();

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
            {t(label.key, label.name)}
          </button>
        ))}
      </div>
    </div>
  );
}