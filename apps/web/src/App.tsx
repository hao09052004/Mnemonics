/**
 * App Component - Main dashboard.
 *
 * Reads from `GET /api/v1/items` for the default list view (per the
 * requirement: only call `/api/v1/search` when the user typed a query).
 * Handles session restoration, single-flight refresh-token rotation, and
 * a clean logout that wipes the dashboard state BEFORE the network
 * request so a stale response can't repopulate it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { ItemCard } from './components/ItemCard';
import { LoginForm } from './components/LoginForm';
import { ApiClient, ApiError, type Item, type Session } from './lib/api-client';

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
  const [filters, setFilters] = useState<{
    kind?: string[];
    tags?: string[];
  }>({});

  const sessionRef = useRef<Session | null>(null);
  // Tokens a stale response would need to match before it can write UI
  // state — protects against the user logging out mid-request.
  const requestEpoch = useRef(0);

  const clearDashboardState = useCallback(() => {
    setItems([]);
    setSearchResults(null);
    setSearchQuery('');
    setFilters({});
    setError(null);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Session restoration on mount.
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

  // Load list whenever the session (or filters) change.
  useEffect(() => {
    if (!session) return;
    if (searchQuery) return; // search has its own effect
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, filters.kind?.join('|'), filters.tags?.join('|')]);

  // Run search only when the user typed a query.
  useEffect(() => {
    if (!session) return;
    if (!searchQuery) {
      setSearchResults(null);
      return;
    }
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, session]);

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
      if (epoch !== requestEpoch.current) return; // stale
      setItems(result.items);
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load items';
      setError(message);
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
          filters: {
            kind: filters.kind,
            tags: filters.tags
          },
          limit: 50
        },
        token
      );
      if (epoch !== requestEpoch.current) return;
      setSearchResults(result.hits);
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      const message = err instanceof Error ? err.message : 'Failed to search';
      setError(message);
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [searchQuery, filters.kind, filters.tags]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query) loadList();
  };

  const handleLogin = (newSession: Session) => {
    setSession(newSession);
    api.saveSession(newSession);
    clearDashboardState();
  };

  const handleLogout = () => {
    // Clear local state BEFORE the network round-trip so a slow logout
    // never repopulates the dashboard with stale data.
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
    const current = sessionRef.current;
    if (!current) return;
    const epoch = ++requestEpoch.current;
    // Optimistic removal so the user sees the action immediately.
    setItems(items.filter(item => item.id !== id));
    if (searchResults) setSearchResults(searchResults.filter(item => item.id !== id));
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setSession(null);
        return;
      }
      await api.deleteItem(id, token);
      if (epoch !== requestEpoch.current) return;
      // Re-fetch once so server-side deletes (other tab) are reflected.
      if (!searchQuery) loadList();
    } catch (err) {
      if (epoch !== requestEpoch.current) return;
      if (err instanceof ApiError && err.status === 404) {
        // Already gone — accept it as success.
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to delete';
      setError(message);
      // Re-add the item so the UI doesn't lie.
      loadList();
    }
  };

  if (!session) {
    return <LoginForm api={api} onLogin={handleLogin} />;
  }

  const displayItems = searchQuery ? (searchResults ?? []) : items;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Mnemonics</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, color: '#666' }}>{session.user.email}</span>
          <button
            onClick={handleLogout}
            data-testid="logout-btn"
            style={{
              padding: '8px 16px',
              border: '1px solid #ddd',
              borderRadius: 4,
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Đăng xuất
          </button>
        </div>
      </header>

      <SearchBar onSearch={handleSearch} initialQuery={searchQuery} loading={loading} />

      <div style={{ marginBottom: 24, display: 'flex', gap: 12 }}>
        <select
          value={filters.kind?.[0] || 'all'}
          onChange={(e) => {
            const value = e.target.value;
            setFilters({
              ...filters,
              kind: value === 'all' ? undefined : [value]
            });
          }}
          style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4 }}
        >
          <option value="all">Tất cả loại</option>
          <option value="link">Link</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="screenshot">Screenshot</option>
        </select>
      </div>

      {error && (
        <div role="alert" style={{ padding: 12, marginBottom: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>Đang tải...</div>
      ) : displayItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
          {searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có mục nào được lưu'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {displayItems.map(item => (
            <ItemCard key={item.id} item={item} onDelete={() => handleDelete(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
