/**
 * TagSidebar
 *
 * Lists all the user's tags, sorted by usage, and lets them filter the
 * dashboard by clicking a tag. Driven by GET /api/v1/tags.
 */

import { useEffect, useState } from 'react';
import { ApiClient, type TagListItem } from '../lib/api-client';

interface TagSidebarProps {
  api: ApiClient;
  accessToken: string;
  selectedTag: string | null;
  onSelect: (normalizedTag: string | null) => void;
  refreshKey: number;
}

export function TagSidebar({ api, accessToken, selectedTag, onSelect, refreshKey }: TagSidebarProps) {
  const [tags, setTags] = useState<TagListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.listTags(accessToken)
      .then((result) => {
        if (cancelled) return;
        setTags(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Không thể tải danh sách tag.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, accessToken, refreshKey]);

  return (
    <aside
      data-testid="tag-sidebar"
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1 }}>TAGS</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{tags.length}</span>
      </div>

      {loading && <div style={{ fontSize: 12, color: '#64748b' }}>Đang tải...</div>}

      {error && (
        <div role="alert" style={{ fontSize: 11, color: '#b91c1c' }}>{error}</div>
      )}

      {!loading && !error && tags.length === 0 && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          Chưa có tag nào. Hãy lưu memory để hệ thống tự sinh tag.
        </div>
      )}

      {!loading && tags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
          <button
            type="button"
            onClick={() => onSelect(null)}
            data-testid="tag-filter-all"
            style={tagButtonStyle(selectedTag === null)}
          >
            <span style={{ fontWeight: 700 }}>Tất cả</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
          </button>
          {tags.map((tag) => {
            const normalized = tag.normalized_name ?? tag.name.toLowerCase();
            const active = selectedTag === normalized;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onSelect(active ? null : normalized)}
                data-testid={`tag-filter-${normalized}`}
                style={tagButtonStyle(active)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{tag.name}</span>
                <span style={{ fontSize: 11, color: active ? '#4338ca' : '#94a3b8', marginLeft: 8 }}>{tag.item_count}</span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function tagButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: 0,
    background: active ? '#eef2ff' : 'transparent',
    color: active ? '#4338ca' : '#1e293b',
    borderRadius: 8,
    padding: '6px 8px',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
    textAlign: 'left'
  };
}
