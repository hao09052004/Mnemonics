import { Icon, type IconName } from './Icons';
import { useLocale } from '../../lib/locale';

export type CaptureAction = 'link' | 'note' | 'quote' | 'image' | 'document';

interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: CaptureAction) => void;
}

const ACTIONS: Array<{ key: CaptureAction; label: string; transKey: string; icon: IconName }> = [
  { key: 'link', label: 'Save Link', transKey: 'capture_link', icon: 'link' },
  { key: 'note', label: 'Quick Note', transKey: 'capture_note', icon: 'plus' },
  { key: 'quote', label: 'Save Quote', transKey: 'capture_quote', icon: 'file' },
  { key: 'image', label: 'Upload Image', transKey: 'capture_image', icon: 'image' },
  { key: 'document', label: 'Upload Document', transKey: 'capture_document', icon: 'upload' },
];

export function CaptureSheet({ open, onClose, onAction }: CaptureSheetProps) {
  const { t } = useLocale();
  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="capture-sheet"
    >
      <div
        className="capture-sheet capture-sheet--menu"
        role="dialog"
        aria-modal="true"
        aria-label={t('capture_sheet_title', 'Capture a memory')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t('capture_sheet_title', 'Capture a memory')}</h2>
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
            {t(a.transKey, a.label)}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}