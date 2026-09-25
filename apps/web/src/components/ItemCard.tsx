/**
 * ItemCard Component
 */

import { useState } from 'react';
import type { RelatedItem } from '../lib/api-client';

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
  relatedItems?: RelatedItem[];
  relatedLoading?: boolean;
  onLoadRelated?: () => void;
}

export function ItemCard({ item, onDelete, relatedItems = [], relatedLoading = false, onLoadRelated }: ItemCardProps) {
  const [relatedOpen, setRelatedOpen] = useState(false);

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

  const statusLabel = item.status === 'ready'
    ? '✓ Ready'
    : item.status === 'processing'
      ? '⟳ Đang xử lý'
      : item.status === 'failed'
        ? '✕ Lỗi'
        : item.status
          ? '• ' + item.status
          : null;

  return (
    <div
      data-testid={`item-card-${item.id}`}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
        background: 'white',
        transition: 'box-shadow 0.2s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{getTypeIcon(item.kind)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {statusLabel && (
            <span style={{ fontSize: 10, color: item.status === 'failed' ? '#dc2626' : '#64748b', fontWeight: 700 }}>
              {statusLabel}
            </span>
          )}
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(item.captured_at)}</span>
        </div>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#111' }}>
        {item.title}
      </h3>

      {item.snippet && (
        <p style={{ fontSize: 13, color: '#4b5563', marginBottom: 8, lineHeight: 1.5 }}>
          {item.snippet}
        </p>
      )}

      {item.tags && item.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {item.tags.slice(0, 5).map(tag => (
            <span
              key={tag}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: '#eef2ff',
                color: '#4338ca',
                borderRadius: 12
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {onLoadRelated && item.status === 'ready' && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
          <button
            type="button"
            data-testid={`related-toggle-${item.id}`}
            onClick={async () => {
              const nextOpen = !relatedOpen;
              setRelatedOpen(nextOpen);
              if (nextOpen && relatedItems.length === 0) onLoadRelated();
            }}
            style={{
              border: 0,
              background: 'transparent',
              padding: 0,
              color: '#4f46e5',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer'
            }}
          >
            {relatedOpen ? '↗ Ẩn ý liên quan' : '↗ Ý liên quan'}
          </button>

          {relatedOpen && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {relatedLoading && (
                <div style={{ fontSize: 11, color: '#64748b' }}>Đang tìm ký ức liên quan...</div>
              )}
              {!relatedLoading && relatedItems.length === 0 && (
                <div style={{ fontSize: 11, color: '#64748b' }}>Chưa có liên kết ngữ nghĩa.</div>
              )}
              {!relatedLoading && relatedItems.map((related) => (
                <div
                  key={related.id}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#f8fafc'
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{related.title}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: '#64748b' }}>
                    {Math.round(Number(related.similarity || 0) * 100)}% tương đồng · {related.type}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {item.source_url && (
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 10, color: '#4f46e5', fontSize: 11, textDecoration: 'none' }}
        >
          Mở nguồn ↗
        </a>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          data-testid="delete-item"
          style={{
            marginTop: 12,
            fontSize: 12,
            padding: '5px 12px',
            border: '1px solid #fca5a5',
            color: '#dc2626',
            background: 'white',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Xóa
        </button>
      )}
    </div>
  );
}
