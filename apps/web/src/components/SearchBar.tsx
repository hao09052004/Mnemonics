/**
 * SearchBar Component
 */

import { useState } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  initialQuery?: string;
  loading?: boolean;
}

export function SearchBar({ onSearch, initialQuery = '', loading = false }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm kiếm kiến thức của bạn..."
          style={{
            flex: 1,
            padding: '12px 16px',
            fontSize: 16,
            border: '1px solid #ddd',
            borderRadius: 8,
            outline: 'none'
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: loading ? '#ccc' : '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 16
          }}
        >
          {loading ? 'Đang tìm...' : 'Tìm'}
        </button>
      </div>
    </form>
  );
}
