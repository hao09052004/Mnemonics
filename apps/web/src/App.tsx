/**
 * App Component - Main dashboard
 */

import { useEffect, useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { ItemCard } from './components/ItemCard';
import { LoginForm } from './components/LoginForm';
import { ApiClient } from './lib/api-client';

interface Item {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  score?: number;
  captured_at: string;
  tags?: string[];
}

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: {
    id: string;
    email: string;
    name?: string;
    role: string;
  };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<{
    kind?: string[];
    tags?: string[];
  }>({});

  const api = new ApiClient('http://localhost:4000');

  // Check existing session on mount
  useEffect(() => {
    const stored = localStorage.getItem('mnemonics_session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Session;
        if (parsed.expiresAt && parsed.expiresAt * 1000 > Date.now()) {
          setSession(parsed);
        } else {
          localStorage.removeItem('mnemonics_session');
        }
      } catch (e) {
        // Invalid session, clear it
        localStorage.removeItem('mnemonics_session');
      }
    }
  }, []);

  // Load items when session is available
  useEffect(() => {
    if (session) {
      loadItems();
    }
  }, [session]);

  const loadItems = async () => {
    if (!session) return;

    setLoading(true);
    setError(null);

    try {
      // Use search endpoint with empty query to get all items
      const result = await api.search({
        q: searchQuery || '*',
        filters: {
          kind: filters.kind,
          tags: filters.tags
        },
        limit: 50
      }, session.accessToken);

      setItems(result.hits);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load items';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    await loadItems();
  };

  const handleLogin = (newSession: Session) => {
    setSession(newSession);
    localStorage.setItem('mnemonics_session', JSON.stringify(newSession));
  };

  const handleLogout = () => {
    if (session?.accessToken) {
      api.logout(session.accessToken).catch(() => undefined);
    }
    setSession(null);
    localStorage.removeItem('mnemonics_session');
    setItems([]);
  };

  const handleDelete = async (id: string) => {
    if (!session) return;

    try {
      await api.deleteItem(id, session.accessToken);
      setItems(items.filter(item => item.id !== id));
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  };

  // Render login if not authenticated
  if (!session) {
    return <LoginForm api={api} onLogin={handleLogin} />;
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Mnemonics</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, color: '#666' }}>
            {session.user.email}
          </span>
          <button
            onClick={handleLogout}
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

      {/* Search Bar */}
      <SearchBar
        onSearch={handleSearch}
        initialQuery={searchQuery}
        loading={loading}
      />

      {/* Filters */}
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

      {/* Error */}
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fee', border: '1px solid #fcc', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Items Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>Đang tải...</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
          {searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có mục nào được lưu'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {items.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
