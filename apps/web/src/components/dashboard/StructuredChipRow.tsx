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
/** M3 — detected type values from item_classifications.detected_type. */
export type DetectedType =
  | 'article' | 'product' | 'recipe' | 'video' | 'quote' | 'highlight'
  | 'webpage' | 'image' | 'note' | 'document' | 'other';

const DETECTED_LABELS: Array<{ id: DetectedType; name: string }> = [
  { id: 'article', name: 'Articles' },
  { id: 'product', name: 'Products' },
  { id: 'recipe', name: 'Recipes' },
  { id: 'video', name: 'Videos' },
  { id: 'quote', name: 'Quotes' },
  { id: 'highlight', name: 'Highlights' },
  { id: 'webpage', name: 'Webpages' },
  { id: 'image', name: 'Images' },
  { id: 'note', name: 'Notes' },
  { id: 'document', name: 'Documents' },
  { id: 'other', name: 'Other' }
];

interface Props {
  active: DetectedType[];
  onChange: (next: DetectedType[]) => void;
}

export function StructuredChipRow({ active, onChange }: Props) {
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
            {label.name}
          </button>
        ))}
      </div>
    </div>
  );
}
