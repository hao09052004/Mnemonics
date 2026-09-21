/**
 * Smoke tests for the web ApiClient.
 *
 * These run as plain Node ESM with the localStorage shim below — we
 * don't pull in vitest or jest because apps/web doesn't ship a test
 * runner yet (adding one is out of scope for this fix). Each test
 * scenario maps to one of the regression cases in the bug ticket.
 *
 * Run with: `node apps/web/__tests__/api-client.test.mjs`
 */
import { ApiClient, ApiError } from '../src/lib/api-client.js';

// Minimal localStorage shim.
const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); }
};

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, message) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(message);
  console.error('  ✗ ' + message);
}

async function run(name, fn) {
  console.log('• ' + name);
  store.clear();
  try { await fn(); }
  catch (e) { failed++; failures.push(name + ': ' + (e.message || e)); console.error('  ✗ threw: ' + e.message); }
}

function makeFetch(impl) {
  return async (url, init = {}) => {
    const r = await impl(url, init);
    if (r instanceof Response) return r;
    return new Response(r.body || '', {
      status: r.status || 200,
      headers: r.headers || {},
    });
  };
}

const sampleUser = { id: 'u1', email: 'a@b.com', name: 'A', role: 'user', emailVerified: true };
const sampleSession = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9999999999, tokenType: 'bearer' };

await run('login reads envelope { data: { user, session } }', async () => {
  const api = new ApiClient('http://x');
  api.request = async function(path, opts) {
    assert(path === '/api/v1/auth/login', 'login path correct');
    assert(opts.method === 'POST', 'POST used');
    return { data: { user: sampleUser, session: sampleSession } };
  };
  const out = await api.login({ email: 'a@b.com', password: 'secretsecret1!' });
  assert(out.session, 'session returned');
  assert(out.session.accessToken === 'AT', 'access token propagated');
  assert(out.user.email === 'a@b.com', 'user propagated');
});

await run('register without email verification returns null session but a user', async () => {
  const api = new ApiClient('http://x');
  api.request = async function(path, opts) {
    return { data: { user: sampleUser, session: null } };
  };
  const out = await api.register({ email: 'a@b.com', password: 'secretsecret1!' });
  assert(out.session === null, 'session is null when server says so');
  assert(out.user && out.user.id === 'u1', 'user still returned');
});

await run('deleteItem tolerates 204 No Content (no JSON parsing)', async () => {
  const api = new ApiClient('http://x');
  api.request = async function(path, opts) {
    assert(opts.method === 'DELETE', 'DELETE used');
    return undefined; // simulating 204 path that doesn't try to parse
  };
  await api.deleteItem('item-1', 'AT');
});

await run('listItems unwraps { data: { items, total } }', async () => {
  const api = new ApiClient('http://x');
  api.request = async function(path, opts) {
    return {
      data: {
        items: [{ id: 'i1', kind: 'link', title: 't', captured_at: '2026-01-01T00:00:00Z', tags: ['x'] }],
        total: 1, limit: 50, offset: 0
      }
    };
  };
  const out = await api.listItems('AT', { limit: 50 });
  assert(Array.isArray(out.items), 'items array');
  assert(out.items[0].kind === 'link', 'kind preserved');
  assert(out.total === 1, 'total preserved');
});

await run('ApiError surfaces status, code, requestId', async () => {
  const api = new ApiClient('http://x');
  api.request = async function() {
    throw new ApiError(401, 'Email chưa xác minh', 'EMAIL_NOT_VERIFIED', 'req-1');
  };
  try { await api.login({ email: 'a@b.com', password: 'secretsecret1!' }); }
  catch (e) {
    assert(e instanceof ApiError, 'is ApiError');
    assert(e.status === 401, 'status');
    assert(e.code === 'EMAIL_NOT_VERIFIED', 'code');
    assert(e.requestId === 'req-1', 'requestId');
  }
});

await run('session storage roundtrip', async () => {
  const api = new ApiClient('http://x');
  const session = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9999999999, user: sampleUser };
  api.saveSession(session);
  const loaded = api.loadStoredSession();
  assert(loaded && loaded.accessToken === 'AT', 'roundtrip ok');
  api.saveSession(null);
  assert(api.loadStoredSession() === null, 'clear ok');
});

await run('isAccessTokenExpired uses leeway window', async () => {
  const api = new ApiClient('http://x');
  const expired = { accessToken: 'AT', expiresAt: Math.floor(Date.now() / 1000) - 10 };
  assert(api.isAccessTokenExpired(expired) === true, 'expired reports true');
  const fresh = { accessToken: 'AT', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  assert(api.isAccessTokenExpired(fresh) === false, 'fresh reports false');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
