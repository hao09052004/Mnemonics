import { Icon, type IconName } from './Icons';

export type CaptureAction = 'link' | 'note' | 'image' | 'document';

interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: CaptureAction) => void;
}

const ACTIONS: Array<{ key: CaptureAction; label: string; icon: IconName }> = [
  { key: 'link', label: 'Save Link', icon: 'link' },
  { key: 'note', label: 'Quick Note', icon: 'plus' },
  { key: 'image', label: 'Upload Image', icon: 'image' },
  { key: 'document', label: 'Upload Document', icon: 'upload' },
];

export function CaptureSheet({ open, onClose, onAction }: CaptureSheetProps) {
  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="capture-sheet"
    >
      <div
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Capture a memory"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Capture a memory</h2>
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            data-testid={`capture-${a.key}`}
            onClick={() => {
              onAction(a.key);
              onClose();
            }}
          >
            <Icon name={a.icon} />
            {a.label}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}