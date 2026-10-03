/**
 * The authenticated dashboard.
 *
 * This is the same product surface the legacy App.tsx used to render
 * — the new IA puts it under /app. We:
 *   - keep all existing API calls and the ApiClient contract intact
 *   - reuse the existing SearchBar / ItemCard / ItemDetailModal /
 *     QuickCapture / TagSidebar / LoginForm / ForgotPasswordForm
 *     components unchanged
 *   - wrap the layout in a DashboardShell that pulls the design
 *     tokens in via class names
 *   - leave any "demo mode" banner behaviour in place (toggled via
 *     VITE_DEMO_MODE) because the existing tests rely on it
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBar } from '../components/SearchBar';
import { ItemCard } from '../components/ItemCard';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { LoginForm } from '../components/LoginForm';
import { QuickCapture } from '../components/QuickCapture';
import { TagSidebar } from '../components/TagSidebar';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { ApiClient, ApiError, type Item, type ItemDetail, type RelatedItem, type Session } from '../lib/api-client';

interface ItemsResponse {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}

interface DashboardPageProps {
  api: ApiClient;
}

export function DashboardPage({ api }: DashboardPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [filters, setFilters] = useState<{ kind?: string[]; tags?: string[] }>({});
  const [relatedItems, setRelatedItems] = useState<Record<string, RelatedItem[]>>({});
  const [relatedLoading, setRelatedLoading] = useState<Record<string, boolean>>({});
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, ItemDetail>>({});
  const [tagsRefreshKey, setTagsRefreshKey] = useState(0);
  const [tagFilteredList, setTagFilteredList] = useState<Item[] | null>(null);
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');

  const sessionRef = useRef<Session | null>(null);
  const requestEpoch = useRef(0);
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const clearDashboardState = useCallback(() => {
    setItems([]);
    setSearchResults(null);
    setSearchQuery('');
    setFilters({});
    setRelatedItems({});
    setRelatedLoading({});
    setError(null);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (!stored) return;
    if (api.isAccessTokenExpired(stored) && stored.refreshToken) {
      api.refreshSession(stored).then((refreshed) => {
        if (refreshed) setSession(refreshed);
        else api.saveSession(null);
      });
    } else {
      setSession(stored);
    }
  }, [api]);

  const loadList = useCallback(async () => {
    if (!sessionRef.current) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);

    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setSession(null);
        return;
      }
      const result: ItemsResponse = await api.listItems(token, { limit: 50 });
      if (epoch !== requestEpoch.current) return;
      setItems(result.items);
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [api]);

  const runSearch = useCallback(async () => {
    if (!sessionRef.current || !searchQuery) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);

    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setSession(null);
        return;
      }
      const result = await api.search(
        {
          q: searchQuery,
          filters: { kind: filters.kind, tags: filters.tags },
          limit: 50
        },
        token
      );
      if (epoch !== requestEpoch.current) return;
      setSearchResults(result.hits);
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      setError(err instanceof Error ? err.message : 'Failed to search');
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [api, searchQuery, filters.kind, filters.tags]);

  useEffect(() => {
    if (!session) return;
    if (searchQuery) return;
    loadList();
  }, [session, searchQuery, filters.kind?.join('|'), filters.tags?.join('|'), loadList]);

  useEffect(() => {
    if (!session || !searchQuery) {
      setSearchResults(null);
      return;
    }
    runSearch();
  }, [session, searchQuery, runSearch]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query) loadList();
  };

  const handleCaptured = useCallback(
    async (itemId: string) => {
      setSearchQuery('');
      setSearchResults(null);
      requestEpoch.current += 1;
      setLoading(true);
      setError(null);

      try {
        const token = await api.getValidAccessToken();
        if (!token) {
          setSession(null);
          return;
        }

        for (let attempt = 0; attempt < 16; attempt += 1) {
          const result: ItemsResponse = await api.listItems(token, { limit: 50 });
          setItems(result.items);
          const captured = result.items.find((item) => String(item.id) === String(itemId));
          if (captured?.status === 'ready' || captured?.status === 'failed') {
            setTagsRefreshKey((key) => key + 1);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể cập nhật memory mới.');
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  const handleLoadRelated = useCallback(
    async (itemId: string) => {
      if (!sessionRef.current || relatedLoading[itemId]) return;
      setRelatedLoading((current) => ({ ...current, [itemId]: true }));

      try {
        const token = await api.getValidAccessToken();
        if (!token) {
          setSession(null);
          return;
        }
        const related = await api.getRelatedItems(itemId, token, 5);
        setRelatedItems((current) => ({ ...current, [itemId]: related }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể tải ký ức liên quan.');
      } finally {
        setRelatedLoading((current) => ({ ...current, [itemId]: false }));
      }
    },
    [api, relatedLoading]
  );

  const handleSelectTag = useCallback(
    async (normalizedTag: string | null) => {
      if (!sessionRef.current) return;

      if (normalizedTag === null) {
        setFilters((current) => ({ ...current, tags: undefined }));
        setTagFilteredList(null);
        return;
      }

      setFilters((current) => ({ ...current, tags: [normalizedTag] }));
      setSearchQuery('');

      const token = await api.getValidAccessToken();
      if (!token) {
        setSession(null);
        return;
      }
      try {
        const result = await api.itemsByTag(normalizedTag, token);
        setTagFilteredList(result.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể lọc theo tag.');
      }
    },
    [api]
  );

  const handleOpenDetail = useCallback((itemId: string) => {
    setDetailItemId(itemId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailItemId(null);
  }, []);

  const handleDetailSaved = useCallback((updated: ItemDetail) => {
    setDetailCache((current) => ({ ...current, [updated.id]: updated }));
    setItems((current) => current.map((item) => (
      item.id === updated.id ? { ...item, title: updated.title } : item
    )));
    setSearchResults((current) => current
      ? current.map((item) => (item.id === updated.id ? { ...item, title: updated.title } : item))
      : current);
    setTagFilteredList((current) => current
      ? current.map((item) => (item.id === updated.id ? { ...item, title: updated.title } : item))
      : current);
  }, []);

  const handleLogin = (newSession: Session) => {
    setSession(newSession);
    api.saveSession(newSession);
    clearDashboardState();
  };

  const handleLogout = () => {
    const currentSession = sessionRef.current;
    requestEpoch.current++;
    setSession(null);
    api.saveSession(null);
    clearDashboardState();
    if (currentSession?.accessToken) {
      api.logout(currentSession.accessToken).catch(() => undefined);
    }
    navigate('/');
  };

  const handleDelete = async (id: string) => {
    if (!sessionRef.current) return;
    const epoch = ++requestEpoch.current;
    setItems((current) => current.filter((item) => item.id !== id));
    if (searchResults) setSearchResults((current) => current ? current.filter((item) => item.id !== id) : current);

    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setSession(null);
        return;
      }
      await api.deleteItem(id, token);
      if (epoch !== requestEpoch.current) return;
      setTagsRefreshKey((key) => key + 1);
      if (tagFilteredList) setTagFilteredList((current) => current ? current.filter((item) => item.id !== id) : current);
      if (!searchQuery) loadList();
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      if (err instanceof ApiError && err.status === 404) return;
      setError(err instanceof Error ? err.message : 'Failed to delete');
      loadList();
    }
  };

  if (!session) {
    if (authView === 'forgot') {
      return <ForgotPasswordForm api={api} onCancel={() => setAuthView('login')} onResetRequested={() => undefined} />;
    }
    return <LoginForm api={api} onLogin={handleLogin} onForgotPassword={() => setAuthView('forgot')} />;
  }

  const displayItems: Item[] = searchQuery
    ? (searchResults ?? [])
    : tagFilteredList !== null
      ? tagFilteredList
      : items;
  const activeTag = filters.tags?.[0] ?? null;
  const readyCount = items.filter((item) => item.status === 'ready').length;

  return (
    <DashboardShell
      user={session.user}
      onLogout={handleLogout}
      readyCount={readyCount}
      demoMode={demoMode}
    >
      <QuickCapture api={api} session={session} onCaptured={handleCaptured} />
      <SearchBar onSearch={handleSearch} initialQuery={searchQuery} loading={loading} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)',
          gap: 20,
          alignItems: 'start'
        }}
        className="mnemonics-dashboard-grid"
      >
        <TagSidebar
          api={api}
          accessToken={session.accessToken}
          selectedTag={activeTag}
          onSelect={handleSelectTag}
          refreshKey={tagsRefreshKey}
        />

        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={filters.kind?.[0] || 'all'}
              onChange={(e) => {
                const value = e.target.value;
                setFilters({ ...filters, kind: value === 'all' ? undefined : [value] });
              }}
              style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}
            >
              <option value="all">Tất cả loại</option>
              <option value="link">Link</option>
              <option value="text">Text</option>
              <option value="image">Image</option>
              <option value="screenshot">Screenshot</option>
            </select>

            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {searchQuery
                ? `Đang tìm “${searchQuery}”`
                : activeTag
                  ? `Đang lọc theo tag #${activeTag}`
                  : `${displayItems.length} memories đang hiển thị`}
            </span>

            {activeTag && (
              <button
                type="button"
                data-testid="clear-tag-filter"
                onClick={() => handleSelectTag(null)}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  color: 'var(--muted)'
                }}
              >
                Bỏ lọc
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: 12,
                marginBottom: 16,
                background: 'var(--danger-soft)',
                border: '1px solid #fecaca',
                borderRadius: 10,
                color: 'var(--danger)'
              }}
            >
              {error}
            </div>
          )}

          {loading && displayItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 52, color: 'var(--muted)' }}>Đang tải kiến thức...</div>
          ) : displayItems.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 52,
                color: 'var(--muted)',
                background: 'var(--surface)',
                border: '1px dashed var(--border-strong)',
                borderRadius: 14
              }}
            >
              {searchQuery ? 'Không tìm thấy kết quả' : activeTag ? 'Chưa có memory nào với tag này' : 'Chưa có memory nào được lưu'}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16
              }}
            >
              {displayItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  relatedItems={relatedItems[String(item.id)] || []}
                  relatedLoading={Boolean(relatedLoading[String(item.id)])}
                  onLoadRelated={() => handleLoadRelated(String(item.id))}
                  onDelete={() => handleDelete(item.id)}
                  onOpen={() => handleOpenDetail(item.id)}
                  onSelectTag={(tag) => handleSelectTag(tag)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {detailItemId && (
        <ItemDetailModal
          api={api}
          itemId={detailItemId}
          accessToken={session.accessToken}
          initial={detailCache[detailItemId] ?? null}
          onClose={handleCloseDetail}
          onSaved={handleDetailSaved}
        />
      )}

      <style>{`
        @media (max-width: 860px) {
          .mnemonics-dashboard-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </DashboardShell>
  );
}
