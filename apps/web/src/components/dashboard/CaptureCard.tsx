import { Icon } from './Icons';

interface Props {
  onClick: () => void;
}

export function CaptureCard({ onClick }: Props) {
  return (
    <button type="button" className="capture-card" onClick={onClick} data-testid="capture-card">
      <span className="eyebrow">
        <i aria-hidden="true" /> New memory
      </span>
      <strong>Start typing...</strong>
      <span className="capture-hint">
        <Icon name="plus" size={14} /> or paste anything
      </span>
    </button>
  );
}