import { Icon } from './Icons';

interface Props {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, text, action }: Props) {
  return (
    <section className="empty" aria-label="Empty state">
      <div className="empty-inner">
        <div className="empty-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>{title}</h1>
        <p>{text}</p>
        {action ? (
          <button type="button" className="primary" onClick={action.onClick}>
            <Icon name="plus" size={16} />
            {action.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}