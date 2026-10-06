import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../DashboardPage';
import { ApiClient } from '../../lib/api-client';

afterEach(() => cleanup());

function mockApi(): ApiClient {
  const api = new ApiClient('http://localhost');
  vi.spyOn(api, 'loadStoredSession').mockReturnValue({
    accessToken: 't',
    refreshToken: 'r',
    user: { id: 'u1', email: 'a@b.c', role: 'user', emailVerified: true },
    expiresAt: 0,
  });
  vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
  vi.spyOn(api, 'listItems').mockResolvedValue({
    items: [
      {
        id: '1',
        kind: 'text',
        title: 'Hello',
        snippet: 'World',
        captured_at: new Date().toISOString(),
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  });
  return api;
}

describe('DashboardPage', () => {
  it('renders the dashboard shell and items when session is loaded', async () => {
    const api = mockApi();
    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Hello'));
  });

  it('renders the login form when no session', () => {
    const api = new ApiClient('http://localhost');
    vi.spyOn(api, 'loadStoredSession').mockReturnValue(null);
    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /đăng nhập|sign in/i })).toBeTruthy();
  });

  it('falls back to raw_text when the list endpoint sends no snippet', async () => {
    // Regression: `GET /api/v1/items` returns the stored `raw_text` /
    // `ocr_text` columns and never a `snippet` (only `/search` builds
    // one). Mapping only `snippet` rendered every card body empty.
    const api = new ApiClient('http://localhost');
    vi.spyOn(api, 'loadStoredSession').mockReturnValue({
      accessToken: 't',
      refreshToken: 'r',
      user: { id: 'u1', email: 'a@b.c', role: 'user', emailVerified: true },
      expiresAt: 0,
    });
    vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
    vi.spyOn(api, 'listItems').mockResolvedValue({
      items: [
        {
          id: '2',
          kind: 'text',
          title: 'Facebook',
          raw_text: 'Xin lỗi cả nhà, đang căng mà đứt phựt r',
          source_url: 'https://www.facebook.com/',
          captured_at: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Facebook'));
    expect(
      screen.getByText('Xin lỗi cả nhà, đang căng mà đứt phựt r')
    ).toBeTruthy();
  });

  it('deletes a memory for real and drops the card from the list', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    const deleteItem = vi.spyOn(api, 'deleteItem').mockResolvedValue(undefined);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );

    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Hello'));
    await user.click(screen.getByTestId('item-more-1'));
    await user.click(screen.getByTestId('item-menu-delete-1'));

    await waitFor(() => expect(deleteItem).toHaveBeenCalledWith('1', 't'));
    // The card is removed locally once the BE confirms the delete.
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull());
  });

  it('does not call the API when the user cancels the confirmation', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    const deleteItem = vi.spyOn(api, 'deleteItem').mockResolvedValue(undefined);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );

    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Hello'));
    await user.click(screen.getByTestId('item-more-1'));
    await user.click(screen.getByTestId('item-menu-delete-1'));

    expect(deleteItem).not.toHaveBeenCalled();
    expect(screen.getByText('Hello')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('persists a favorite toggle through PATCH and fills the heart', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    const updateItem = vi.spyOn(api, 'updateItem').mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Hello'));
    const heart = screen.getByTestId('item-favorite-1');
    expect(heart.getAttribute('aria-pressed')).toBe('false');

    await user.click(heart);

    await waitFor(() =>
      expect(updateItem).toHaveBeenCalledWith('1', { isFavorite: true }, 't')
    );
    // Optimistic fill: the heart reflects the new state immediately.
    await waitFor(() =>
      expect(screen.getByTestId('item-favorite-1').getAttribute('aria-pressed')).toBe('true')
    );
  });

  it('reverts the heart when the favorite request fails', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    vi.spyOn(api, 'updateItem').mockRejectedValue(new Error('boom'));

    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText('Hello'));
    await user.click(screen.getByTestId('item-favorite-1'));

    // Optimistic update must be rolled back so the UI never lies.
    await waitFor(() =>
      expect(screen.getByTestId('item-favorite-1').getAttribute('aria-pressed')).toBe('false')
    );
  });
});