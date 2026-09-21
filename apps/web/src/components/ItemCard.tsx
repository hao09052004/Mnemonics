/**
 * ItemCard Component
 */

interface Item {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  score?: number;
  captured_at?: string;
  tags?: string[];
  status?: string;
  image_url?: string;
  source_url?: string;
}

interface ItemCardProps {
  item: Item;
  onDelete?: () => void;
}

export function ItemCard({ item, onDelete }: ItemCardProps) {
  const getTypeIcon = (kind: string) => {
    switch (kind) {
      case 'link': return '🔗';
      case 'text': return '📝';
      case 'image': return '🖼️';
      case 'screenshot': return '📸';
      default: return '📄';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div
      data-testid={`item-card-${item.id}`}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        background: 'white',
        transition: 'box-shadow 0.2s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{getTypeIcon(item.kind)}</span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(item.captured_at)}</span>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#111' }}>
        {item.title}
      </h3>

      {item.snippet && (
        <p style={{ fontSize: 13, color: '#4b5563', marginBottom: 8, lineHeight: 1.5 }}>
          {item.snippet}
        </p>
      )}

      {item.tags && item.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {item.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: '#f3f4f6',
                color: '#4b5563',
                borderRadius: 12
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          data-testid="delete-item"
          style={{
            marginTop: 8,
            fontSize: 12,
            padding: '4px 12px',
            border: '1px solid #fca5a5',
            color: '#dc2626',
            background: 'white',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Xóa
        </button>
      )}
    </div>
  );
}
