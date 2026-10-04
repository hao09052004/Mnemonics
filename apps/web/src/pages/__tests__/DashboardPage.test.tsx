import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});