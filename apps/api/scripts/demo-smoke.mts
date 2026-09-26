import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.DEMO_API_URL || 'http://localhost:4000/api/v1';
const TOKEN = process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token';

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + TOKEN,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  console.log('✓ ' + message);
}

async function waitForReady(itemId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { response, body } = await api('/items?limit=100');
    await assert(response.ok, 'captured item list can be read while polling');

    const items = Array.isArray(body?.data?.items) ? body.data.items : [];
    const item = items.find((candidate: any) => String(candidate.id) === itemId);

    if (item?.status === 'ready') return item;
    if (item?.status === 'failed') throw new Error('captured item entered failed state');

    await sleep(250);
  }
  throw new Error('captured item did not become ready within 10 seconds');
}

async function main() {
  const health = await api('/jobs/health');
  await assert(health.response.ok, 'jobs health endpoint is available');

  const login = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'demo@mnemonics.local',
      password: 'DemoPass123!'
    })
  });
  const loginBody = await login.json();
  await assert(login.ok, 'demo credentials authenticate');
  await assert(loginBody.data.user.email === 'demo@mnemonics.local', 'demo user is returned');

  const clientRequestId = randomUUID();
  const payload = {
    type: 'text',
    title: 'CI demo capture',
    selectedText: 'offline sync and idempotency make browser capture reliable',
    clientRequestId,
    capturedAt: new Date().toISOString()
  };

  const first = await api('/captures', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  await assert(first.response.status === 201, 'demo capture returns 201');
  const itemId = first.body.data.id;

  const duplicate = await api('/captures', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  await assert(duplicate.response.status === 200, 'duplicate capture is idempotent');
  await assert(duplicate.body.data.id === itemId, 'duplicate capture returns the same item');

  const ready = await waitForReady(itemId);
  await assert(ready.status === 'ready', 'capture pipeline reaches ready');

  const search = await api('/search?q=idempotency');
  await assert(search.response.ok, 'search endpoint works in demo mode');
  await assert(
    Array.isArray(search.body?.hits) && search.body.hits.some((hit: any) => hit.id === itemId),
    'captured item is searchable'
  );

  const related = await api('/items/00000000-0000-4000-8000-000000000101/related?limit=5');
  await assert(related.response.ok, 'related-memory endpoint works in demo mode');
  await assert(Array.isArray(related.body?.related_items), 'related-memory response has an array');

  const remove = await api('/items/' + itemId, { method: 'DELETE' });
  await assert(remove.response.status === 204, 'demo smoke item can be deleted');

  console.log('DEMO SMOKE PASSED');
}

main().catch((error) => {
  console.error('DEMO SMOKE FAILED:', error);
  process.exit(1);
});
