import { Icon } from './Icons';
import { useLocale } from '../../lib/locale';

interface Props {
  onClick: () => void;
}

export function CaptureCard({ onClick }: Props) {
  const { t } = useLocale();

  return (
    <button type="button" className="capture-card" onClick={onClick} data-testid="capture-card">
      <span className="eyebrow">
        <i aria-hidden="true" /> {t('capture_card_new', 'New memory')}
      </span>
      <strong>{t('capture_card_typing', 'Start typing...')}</strong>
      <span className="capture-hint">
        <Icon name="plus" size={14} /> {t('capture_card_paste', 'or paste anything')}
      </span>
    </button>
  );
}