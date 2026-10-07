// Regression: the Favorites page rendered the dashboard's default
// empty state ("Your memory starts here") instead of its own, so a
// user clicking the Favorites button saw a page that looked like the
// dashboard and concluded their favorites had been deleted.
//
// Pin the contract: every favorite the server returns must render,
// and when there are none the page must show the favorites-specific
// empty state — not the dashboard's.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { FavoritesPage } from '../FavoritesPage';
import { ApiClient } from '../../lib/api-client';

afterEach(() => cleanup());

function makeApi(favorites: Array<Record<string, unknown>>, total: number): { api: ApiClient; listItems: ReturnType<typeof vi.fn> } {
  const api = new ApiClient('http://localhost');
  vi.spyOn(api, 'loadStoredSession').mockReturnValue({
    accessToken: 't',
    refreshToken: 'r',
    user: { id: 'u1', email: 'a@b.c', role: 'user', emailVerified: true },
    expiresAt: 0
  });
  vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
  const listItems = vi.fn().mockResolvedValue({ items: favorites, total, limit: 100, offset: 0 });
  vi.spyOn(api, 'listItems').mockImplementation(listItems);
  return { api, listItems };
}

describe('FavoritesPage render contract', () => {
  it('renders every favorite the server returns', async () => {
    const { api } = makeApi(
      [
        { id: 'f1', kind: 'link', title: 'Old favorite 1', is_favorite: true, raw_text: '', captured_at: '2026-01-01T00:00:00Z', tags: [] },
        { id: 'f2', kind: 'screenshot', title: 'Old favorite 2', is_favorite: true, raw_text: '', captured_at: '2026-02-01T00:00:00Z', tags: [] },
        { id: 'f3', kind: 'text', title: 'Old favorite 3', is_favorite: true, raw_text: 'body', captured_at: '2026-03-01T00:00:00Z', tags: [] }
      ],
      3
    );

    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Old favorite 1'));
    expect(screen.getByText('Old favorite 2')).toBeTruthy();
    expect(screen.getByText('Old favorite 3')).toBeTruthy();

    // The dashboard's default empty state must not be in the DOM.
    expect(screen.queryByText(/your memory starts here/i)).toBeNull();
  });

  it('shows the favorites-specific empty state (not the dashboard default) when there are none', async () => {
    const { api } = makeApi([], 0);

    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText(/no favorites yet/i));
    expect(screen.queryByText(/your memory starts here/i)).toBeNull();
  });
});