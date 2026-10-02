/**
 * App Component - Main dashboard.
 *
 * Reads from GET /api/v1/items for the default list view and only uses
 * search when the user types a query. The demo build also exposes a
 * first-class Quick Capture flow so the product can be demonstrated
 * without leaving the dashboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { ItemCard } from './components/ItemCard';
import { ItemDetailModal } from './components/ItemDetailModal';
import { LoginForm } from './components/LoginForm';
import { QuickCapture } from './components/QuickCapture';
import { TagSidebar } from './components/TagSidebar';
import { ForgotPasswordForm } from './components/ForgotPasswordForm';
import { ApiClient, ApiError, type Item, type ItemDetail, type RelatedItem, type Session } from './lib/api-client';

interface ItemsResponse {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}

const api = new ApiClient('http://localhost:4000');

export function App() {
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
  }, []);

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
  }, []);

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
  }, [searchQuery, filters.kind, filters.tags]);

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

  const handleCaptured = useCallback(async (itemId: string) => {
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
  }, []);

  const handleLoadRelated = useCallback(async (itemId: string) => {
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
  }, [relatedLoading]);

  const handleSelectTag = useCallback(async (normalizedTag: string | null) => {
    if (!sessionRef.current) return;

    if (normalizedTag === null) {
      setFilters((current) => ({ ...current, tags: undefined }));
      setTagFilteredList(null);
      return;
    }

    setFilters((current) => ({ ...current, tags: [normalizedTag] }));
    setSearchQuery(''); // tag filter uses list endpoint, not search

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
  }, []);

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
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          gap: 16,
          flexWrap: 'wrap'
        }}>
          <div>
            <div style={{ fontSize: 12, color: '#4f46e5', fontWeight: 800, letterSpacing: 1.5 }}>SECOND BRAIN</div>
            <h1 style={{ marginTop: 4, fontSize: 30, fontWeight: 800 }}>Mnemonics</h1>
            <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>Save once — Find anytime.</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{session.user.email}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{readyCount} memory sẵn sàng</div>
            </div>
            <button
              onClick={handleLogout}
              data-testid="logout-btn"
              style={{
                padding: '8px 14px',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                background: 'white',
                cursor: 'pointer'
              }}
            >
              Đăng xuất
            </button>
          </div>
        </header>

        {demoMode && (
          <div
            data-testid="demo-banner"
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #eef2ff, #f8fafc)',
              border: '1px solid #c7d2fe'
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: '#3730a3' }}>⚡ Demo mode</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
              Thử các bước: <b>Lưu nhanh</b> → chờ <b>tag + embedding</b> → tìm kiếm → mở <b>Ý liên quan</b>
              → bấm vào card để xem chi tiết / sửa → click tag để lọc theo tag.
              Dữ liệu demo chạy hoàn toàn trên máy local.
            </div>
          </div>
        )}

        <QuickCapture api={api} session={session} onCaptured={handleCaptured} />

        <SearchBar onSearch={handleSearch} initialQuery={searchQuery} loading={loading} />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
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
                style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: 'white' }}
              >
                <option value="all">Tất cả loại</option>
                <option value="link">Link</option>
                <option value="text">Text</option>
                <option value="image">Image</option>
                <option value="screenshot">Screenshot</option>
              </select>

              <span style={{ fontSize: 12, color: '#64748b' }}>
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
                  style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: 'white', cursor: 'pointer', color: '#475569' }}
                >
                  Bỏ lọc
                </button>
              )}
            </div>

            {error && (
              <div role="alert" style={{ padding: 12, marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#b91c1c' }}>
                {error}
              </div>
            )}

            {loading && displayItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 52, color: '#64748b' }}>Đang tải kiến thức...</div>
            ) : displayItems.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: 52,
                color: '#64748b',
                background: 'white',
                border: '1px dashed #cbd5e1',
                borderRadius: 14
              }}>
                {searchQuery ? 'Không tìm thấy kết quả' : activeTag ? 'Chưa có memory nào với tag này' : 'Chưa có memory nào được lưu'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
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
    </div>
  );
}
