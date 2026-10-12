import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

async function loadApiClient(fetchImpl, session) {
  const source = await readFile(new URL('./api-client.js', import.meta.url), 'utf8');
  const storage = {
    getItem: vi.fn(() => JSON.stringify(session)),
    setItem: vi.fn()
  };
  const cryptoApi = {
    randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  };

  const factory = new Function(
    'fetch',
    'crypto',
    'localStorage',
    source + '\nreturn { searchItemsFromApi, sendCaptureToApi, refreshAccessToken };'
  );

  return {
    client: factory(fetchImpl, cryptoApi, storage),
    storage
  };
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

describe('api client', () => {
  it('refreshes once and retries search with the new access token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'expired' }
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        data: {
          user: { id: 'u1' },
          session: {
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresAt: 1900000000
          }
        }
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        hits: [{ id: 'item-1', title: 'Memory', kind: 'text' }],
        total: 1
      }));

    const { client, storage } = await loadApiClient(fetchImpl, {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1890000000,
      user: { id: 'u1' }
    });

    const result = await client.searchItemsFromApi('distributed systems', 'access-1');

    expect(result.hits).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    expect(fetchImpl.mock.calls[0][0]).toContain('/api/v1/search');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer access-1');

    expect(fetchImpl.mock.calls[1][0]).toContain('/api/v1/auth/refresh');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      refreshToken: 'refresh-1'
    });

    expect(fetchImpl.mock.calls[2][0]).toContain('/api/v1/search');
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer access-2');
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).q).toBe('distributed systems');

    expect(storage.setItem).toHaveBeenCalledWith(
      'mnemonics_session',
      expect.stringContaining('access-2')
    );
  });

  it('retries capture with the same clientRequestId after token refresh', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'expired' }
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        data: {
          user: { id: 'u1' },
          session: {
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresAt: 1900000000
          }
        }
      }))
      .mockResolvedValueOnce(jsonResponse(201, {
        data: { id: 'item-1', status: 'pending' }
      }));

    const { client } = await loadApiClient(fetchImpl, {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1890000000,
      user: { id: 'u1' }
    });

    const result = await client.sendCaptureToApi({
      type: 'text',
      title: 'Retry-safe capture',
      note: 'same request id'
    }, 'access-1');

    expect(result.sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetchImpl.mock.calls[2][1].body);

    expect(firstBody.clientRequestId).toBe(retryBody.clientRequestId);
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer access-2');
  });
});
