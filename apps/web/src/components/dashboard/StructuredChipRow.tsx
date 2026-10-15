/**
 * M3 — structured filter chips.
 *
 * Renders one chip per `DetectedType`. Toggling a chip adds
 * the type to the active `structured.detectedType` array and
 * re-issues the search. The chip is hidden when the response
 * has zero `item_classifications` rows (signalled by the
 * `explain.structResults === 0` heuristic on the parent
 * component — see `EverythingView`).
 */
import { useLocale } from '../../lib/locale';

/** M3 — detected type values from item_classifications.detected_type. */
export type DetectedType =
  | 'article' | 'product' | 'recipe' | 'video' | 'quote' | 'highlight'
  | 'webpage' | 'image' | 'note' | 'document' | 'other';

const DETECTED_LABELS: Array<{ id: DetectedType; name: string; key: string }> = [
  { id: 'article', name: 'Articles', key: 'detected_article' },
  { id: 'product', name: 'Products', key: 'detected_product' },
  { id: 'recipe', name: 'Recipes', key: 'detected_recipe' },
  { id: 'video', name: 'Videos', key: 'detected_video' },
  { id: 'quote', name: 'Quotes', key: 'detected_quote' },
  { id: 'highlight', name: 'Highlights', key: 'detected_highlight' },
  { id: 'webpage', name: 'Webpages', key: 'detected_webpage' },
  { id: 'image', name: 'Images', key: 'detected_image' },
  { id: 'note', name: 'Notes', key: 'detected_note' },
  { id: 'document', name: 'Documents', key: 'detected_document' },
  { id: 'other', name: 'Other', key: 'detected_other' }
];

interface Props {
  active: DetectedType[];
  onChange: (next: DetectedType[]) => void;
}

export function StructuredChipRow({ active, onChange }: Props) {
  const { t } = useLocale();

  const toggle = (id: DetectedType) => {
    if (active.includes(id)) {
      onChange(active.filter(x => x !== id));
    } else {
      onChange([...active, id]);
    }
  };
  return (
    <div className="filter-row" data-testid="structured-chip-row">
      <div className="chips" aria-label="Detected type">
        {DETECTED_LABELS.map((label) => (
          <button
            key={label.id}
            type="button"
            aria-pressed={active.includes(label.id)}
            onClick={() => toggle(label.id)}
            className={`chip ${active.includes(label.id) ? 'active' : ''}`}
            data-testid={`chip-detected-${label.id}`}
          >
            {t(label.key, label.name)}
          </button>
        ))}
      </div>
    </div>
  );
}
