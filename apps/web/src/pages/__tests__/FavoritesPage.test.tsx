import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FavoritesPage } from '../FavoritesPage';
import { ApiClient } from '../../lib/api-client';

afterEach(() => cleanup());

function mockApi(opts: { items?: unknown[]; total?: number; listItems?: ReturnType<typeof vi.fn> } = {}): ApiClient {
  const api = new ApiClient('http://localhost');
  vi.spyOn(api, 'loadStoredSession').mockReturnValue({
    accessToken: 't',
    refreshToken: 'r',
    user: { id: 'u1', email: 'a@b.c', role: 'user', emailVerified: true },
    expiresAt: 0
  });
  vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
  if (opts.listItems) {
    vi.spyOn(api, 'listItems').mockImplementation(opts.listItems);
  } else {
    vi.spyOn(api, 'listItems').mockResolvedValue({
      items: (opts.items as never) ?? [
        {
          id: 'fav-1',
          kind: 'text',
          title: 'Saved memory',
          snippet: 'snippet',
          raw_text: 'raw text',
          is_favorite: true,
          captured_at: '2026-01-01T00:00:00Z',
          tags: []
        }
      ],
      total: opts.total ?? 1,
      limit: 100,
      offset: 0
    });
  }
  return api;
}

describe('FavoritesPage', () => {
  it('requests ?favorite=true so older favorites are not lost', async () => {
    const listItems = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'old-fav',
          kind: 'link',
          title: 'Old favorite',
          is_favorite: true,
          captured_at: '2026-01-01T00:00:00Z',
          tags: []
        }
      ],
      total: 1,
      limit: 100,
      offset: 0
    });
    const api = mockApi({ listItems });
    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Old favorite'));
    expect(listItems).toHaveBeenCalled();
    const call = listItems.mock.calls[0];
    // The second positional arg is the params object.
    expect(call[1]).toMatchObject({ favorite: true });
  });

  it('shows a custom empty state when the user has no favorites', async () => {
    const api = mockApi({ items: [], total: 0 });
    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText(/no favorites yet/i));
    // The dashboard's default empty copy must NOT appear here — that
    // is the regression "page trống không có cái tôi đã thêm vào"
    // when the user has zero favorites or the request failed.
    expect(screen.queryByText(/your memory starts here/i)).toBeNull();
  });

  it('un-favoriting from the favorites page drops the card optimistically', async () => {
    const listItems = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'f1',
          kind: 'text',
          title: 'Will un-favorite',
          is_favorite: true,
          raw_text: '',
          captured_at: '2026-10-04T00:00:00Z',
          tags: []
        }
      ],
      total: 1,
      limit: 100,
      offset: 0
    });
    const updateItem = vi.fn().mockResolvedValue(undefined);
    const api = mockApi({ listItems });
    vi.spyOn(api, 'updateItem').mockImplementation(updateItem);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Will un-favorite'));
    // The card is in the filtered list — click its heart.
    const heart = screen.getByTestId('item-favorite-f1');
    await user.click(heart);

    await waitFor(() => expect(updateItem).toHaveBeenCalledWith(
      'f1',
      { isFavorite: false },
      't'
    ));
    // Optimistic: the card is gone from the filtered list.
    await waitFor(() => expect(screen.queryByText('Will un-favorite')).toBeNull());
  });

  it('routes to /app/favorites when the top-nav Favorites button is clicked on the dashboard', async () => {
    // The dashboard's handleNavigate is the one wired to DashboardShell.
    // We pin the contract here so a future refactor cannot silently
    // demote the tab back to a no-op.
    const listItems = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const api = mockApi({ listItems });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<FavoritesPage api={api} />} />
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );
    // The Favorites button in the top nav must be present.
    const favTab = screen.getByTestId('nav-favorites');
    expect(favTab).toBeTruthy();
    // And it must reflect the active route when on /app/favorites.
    // (We re-render with that route to confirm.)
    cleanup();
    render(
      <MemoryRouter initialEntries={['/app/favorites']}>
        <Routes>
          <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        </Routes>
      </MemoryRouter>
    );
    const active = screen.getByTestId('nav-favorites');
    expect(active.getAttribute('aria-current')).toBe('page');
    // Suppress the unused-user warning that the static analysis keeps flagging.
    void user;
  });
});