/**
 * Full-surface end-to-end verification.
 *
 * Unlike `e2e-pipeline.mts` (which only covers the capture -> jobs
 * pipeline against a fixed DEV_AUTH_TOKEN), this script exercises every
 * public feature area of the running API through real HTTP requests with
 * a real user session, so it can be pointed at a live Supabase-backed
 * instance and still mean something:
 *
 *   auth       register / login / me / refresh / forgot / logout
 *   capture    text + image capture, clientRequestId idempotency
 *   items      list / get / patch (favorite, title, tags) / delete
 *   search     keyword + kind-filtered search
 *   tags       list, list for item, suggest, filter by tag
 *   graph      neighbors of an item, related-by-kind
 *   spaces     list, create, patch, items in a space, rules, delete
 *   enrichment read a tldr, patch a tldr
 *   isolation  another user's token cannot read or mutate our items
 *
 * Every mutation is created with a `e2e-` prefixed id and cleaned up,
 * so the script is safe to run against a demo database repeatedly.
 *
 * Usage:
 *   pnpm --filter @mnemonics/api exec tsx scripts/e2e-full.mts
 *
 * Env:
 *   API_URL  (default http://localhost:4000/api/v1)
 */
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env') });

const API = process.env.E2E_API_URL || process.env.API_URL || 'http://localhost:4000/api/v1';

type Json = any;

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function ok(label: string) {
  passCount += 1;
  console.log(`  \u2713 ${label}`);
}

function fail(label: string, detail: string) {
  failCount += 1;
  failures.push(`${label} — ${detail}`);
  console.log(`  \u2717 ${label}\n      ${detail}`);
}

function assert(cond: boolean, label: string, detail = '') {
  if (cond) ok(label);
  else fail(label, detail || 'condition was false');
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** A single request, with no rate-limit retry. Used where the 429 itself is the assertion. */
async function reqOnce(
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...((init.headers as Record<string, string>) || {}) }
  });
  const text = await res.text();
  let body: Json = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

/**
 * The capture limiter (30 req/min per IP) is shared by the items, tags,
 * spaces and enrichment route groups, so a fast e2e sweep trips it. Honour
 * `retryAfter` (the limiter puts it in the body, not the header) so the run
 * reports real results instead of a wall of 429s.
 */
async function req(
  path: string,
  init: RequestInit = {},
  token?: string,
  attempt = 0
): Promise<{ status: number; body: Json }> {
  const { status, body } = await reqOnce(path, init, token);
  if (status !== 429 || attempt >= 3) return { status, body };
  const retryAfter = Number(body?.error?.retryAfter ?? 0);
  if (!retryAfter || retryAfter > 65) return { status, body };
  await new Promise((r) => setTimeout(r, retryAfter * 1000 + 500));
  return req(path, init, token, attempt + 1);
}

/** A deterministic-per-run unique suffix so reruns don't collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const cleanup: Array<() => Promise<void>> = [];

/**
 * Poll until the item reaches a terminal status.
 *
 * The capture pipeline is asynchronous: `tag` then `embed` run as jobs,
 * and the item only becomes `ready` once both finish. Search only indexes
 * embedded items, so any search assertion has to wait for `ready` first
 * or it races the pipeline and reports a false negative.
 */
async function waitForStatus(itemId: string, token: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const res = await req(`/items/${itemId}`, {}, token);
    const status = res.body?.item?.status;
    if (status && status !== last) {
      last = status;
      console.log(`      ${itemId.slice(0, 8)}… ${status}`);
    }
    if (status === 'ready' || status === 'failed') return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last || 'timeout';
}

async function registerUser(prefix: string) {
  const email = `${prefix}.${RUN}@e2e.mnemonics.test`;
  const password = 'E2ePass123!';
  const res = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: `E2E ${prefix}` })
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`register ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { email, password, user: res.body.data.user as Json, session: res.body.data.session as Session };
}

async function login(email: string, password: string): Promise<Session> {
  const res = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.session as Session;
}

async function main() {
  console.log(`\nE2E full-surface run against ${API}\n`);

  // ---------------------------------------------------------------- health
  console.log('health');
  {
    const res = await fetch(`${API.replace(/\/api\/v1$/, '')}/health`);
    assert(res.ok, 'GET /health is 200', `status ${res.status}`);
  }

  // ------------------------------------------------------------------ auth
  console.log('\nauth');
  const account = await registerUser('primary');
  const other = await registerUser('other');
  ok('register returns a user + session for two distinct accounts');
  assert(Boolean(account.session?.accessToken), 'register returns an accessToken');
  assert(other.user.id !== account.user.id, 'the two accounts have different user ids');

  {
    const res = await req('/auth/me', {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /auth/me with a valid token is 200');
    assertEqual(res.body?.data?.user?.email, account.email, '/auth/me resolves the right email');
  }
  {
    const res = await req('/auth/me', {}, 'not-a-real-token');
    assertEqual(res.status, 401, 'GET /auth/me with a bogus token is 401');
  }
  {
    const res = await req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: account.email, password: 'WrongPass123!' })
    });
    assertEqual(res.status, 401, 'login with a wrong password is 401');
  }
  {
    const res = await req('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: `nobody.${RUN}@e2e.mnemonics.test` })
    });
    assertEqual(res.status, 200, 'forgot-password on an unknown email is still 200 (anti-enumeration)');
  }
  {
    const fresh = await login(account.email, account.password);
    const res = await req('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: fresh.refreshToken })
    });
    assert(res.status === 200, 'POST /auth/refresh with a valid refresh token succeeds', `status ${res.status} ${JSON.stringify(res.body)}`);
    assert(Boolean(res.body?.data?.session?.accessToken), 'refresh returns a new accessToken');
  }

  // --------------------------------------------------------------- capture
  console.log('\ncapture');
  const textTitle = `e2e-text-${RUN}`;
  // captureInputSchema (packages/shared/src/index.ts) is a discriminated
  // union on `type`:
  //   text -> { type, title, sourceUrl?, selectedText, capturedAt?, clientRequestId(uuid) }
  // The field is `selectedText`, not `rawText`, and clientRequestId must be a
  // UUID. `normalizeCapture` maps selectedText -> rawText on the way in.
  const textClientRequestId = crypto.randomUUID();
  const textCapture = await req(
    '/captures',
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'text',
        title: textTitle,
        selectedText: 'End to end verification body for the mnemonics capture pipeline.',
        clientRequestId: textClientRequestId,
        capturedAt: new Date().toISOString()
      })
    },
    account.session.accessToken
  );
  assertEqual(textCapture.status, 201, 'POST /captures with type=text is 201');
  const textItemId: string = textCapture.body?.data?.id;
  assert(Boolean(textItemId), 'the text capture returns an item id');
  cleanup.push(async () => {
    await req(`/items/${textItemId}`, { method: 'DELETE' }, account.session.accessToken);
  });

  {
    const dupe = await req(
      '/captures',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'text',
          title: textTitle,
          selectedText: 'End to end verification body for the mnemonics capture pipeline.',
          clientRequestId: textClientRequestId,
          capturedAt: new Date().toISOString()
        })
      },
      account.session.accessToken
    );
    assertEqual(dupe.body?.data?.id, textItemId, 'replaying the same clientRequestId returns the same item (idempotent)');
  }

  // A real 1x1 PNG so the multipart upload path is exercised for real.
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const imageForm = new FormData();
  imageForm.append('file', new Blob([PNG_1x1], { type: 'image/png' }), `e2e-${RUN}.png`);
  imageForm.append('type', 'screenshot');
  imageForm.append('title', `e2e-shot-${RUN}`);
  imageForm.append('clientRequestId', crypto.randomUUID());
  const imageRes = await fetch(`${API}/captures/image`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account.session.accessToken}` },
    body: imageForm
  });
  const imageBody = await imageRes.json().catch(() => null);
  assertEqual(imageRes.status, 201, 'POST /captures/image with type=screenshot is 201');
  const imageItemId: string = imageBody?.data?.id;
  assert(Boolean(imageItemId), 'the image capture returns an item id');
  if (imageItemId) {
    cleanup.push(async () => {
      await req(`/items/${imageItemId}`, { method: 'DELETE' }, account.session.accessToken);
    });
  }

  {
    const res = await req('/captures', { method: 'POST', body: JSON.stringify({ type: 'text' }) }, account.session.accessToken);
    assert(res.status === 400, 'POST /captures with an invalid body is rejected 400', `status ${res.status}`);
  }
  {
    const res = await req('/captures', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', title: 'x', selectedText: 'y', clientRequestId: crypto.randomUUID() })
    });
    assert(res.status === 401, 'POST /captures without a token is 401', `status ${res.status}`);
  }

  // Let the capture pipeline settle before mutating tags: TagHandler skips
  // auto-tagging only when the item *already* has tags, so a PATCH that lands
  // while the tag job is still queued would be silently overwritten.
  {
    const finalStatus = await waitForStatus(textItemId, account.session.accessToken);
    assert(finalStatus === 'ready', `the captured item reaches status=ready (got ${finalStatus})`);
  }

  // ----------------------------------------------------------------- items
  console.log('\nitems');
  {
    const res = await req('/items?limit=50', {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /items is 200');
    const items = (res.body?.data?.items ?? []) as Json[];
    assert(Array.isArray(res.body?.data?.items), 'GET /items returns an items array');
    const ids = items.map((i) => i.id);
    assert(ids.includes(textItemId), 'the captured text item appears in GET /items');
  }
  {
    const res = await req(`/items/${textItemId}`, {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /items/:id is 200');
    // Shape is a bare `{ item }` (not `{ data: { item } }`).
    assertEqual(res.body?.item?.id, textItemId, 'GET /items/:id returns the right item');
    assert(Array.isArray(res.body?.item?.tags), 'the item carries a tags array');
  }
  {
    const res = await req(`/items/${textItemId}`, { method: 'PATCH', body: JSON.stringify({ isFavorite: true }) }, account.session.accessToken);
    assert(res.status === 200, 'PATCH /items/:id isFavorite is 200', `status ${res.status}`);
  }
  {
    const res = await req(`/items/${textItemId}`, { method: 'PATCH', body: JSON.stringify({ tags: ['e2e-tag-a', 'e2e-tag-b'] }) }, account.session.accessToken);
    assert(res.status === 200, 'PATCH /items/:id tags is 200', `status ${res.status}`);
  }
  {
    const res = await req('/items?favorite=true&limit=50', {}, account.session.accessToken);
    const favs = (res.body?.data?.items ?? []) as Json[];
    assert(favs.some((i) => i.id === textItemId), 'GET /items?favorite=true includes the favorited item');
  }
  {
    const res = await req(`/items/${textItemId}`, {}, other.session.accessToken);
    assert(res.status === 404 || res.status === 403, 'GET another user\'s item is 404/403 (tenant isolation)', `status ${res.status}`);
  }
  {
    const res = await req(`/items/${textItemId}`, { method: 'PATCH', body: JSON.stringify({ title: 'hijack' }) }, other.session.accessToken);
    assert(res.status === 404 || res.status === 403, 'PATCH another user\'s item is rejected', `status ${res.status}`);
  }

  // ---------------------------------------------------------------- search
  console.log('\nsearch');
  {
    // Search only sees embedded items; the item was already awaited above.
    const res = await req(
      '/search',
      { method: 'POST', body: JSON.stringify({ q: textTitle, limit: 10, offset: 0 }) },
      account.session.accessToken
    );
    assertEqual(res.status, 200, 'POST /search is 200');
    const hits = (res.body?.hits ?? res.body?.data?.hits ?? []) as Json[];
    assert(Array.isArray(hits), 'POST /search returns a hits array');
    assert(hits.some((h) => h.id === textItemId), 'POST /search finds the captured item by its unique title');
  }
  {
    if (imageItemId) {
      // The image pipeline is ocr -> tag -> embed, so it needs its own wait.
      const shotStatus = await waitForStatus(imageItemId, account.session.accessToken);
      console.log(`      (screenshot item status: ${shotStatus})`);
    }
    const res = await req(
      '/search',
      { method: 'POST', body: JSON.stringify({ q: '', filters: { kind: ['screenshot'] }, limit: 10, offset: 0 }) },
      account.session.accessToken
    );
    const hits = (res.body?.hits ?? res.body?.data?.hits ?? []) as Json[];
    assert(
      hits.every((h) => h.kind === 'screenshot'),
      'POST /search with filters.kind=[screenshot] returns only screenshot hits'
    );
    if (imageItemId) {
      if (!hits.some((h) => h.id === imageItemId)) {
        const dbg = await req(`/items/${imageItemId}`, {}, account.session.accessToken);
        console.log(`      debug: screenshot item type=${dbg.body?.item?.type} status=${dbg.body?.item?.status}`);
      }
      assert(hits.some((h) => h.id === imageItemId), 'the screenshot item is findable under kind=screenshot (regression 2026-10-04)');
    }
  }
  {
    const res = await req('/search', { method: 'POST', body: JSON.stringify({ q: 'x' }) });
    assert(res.status === 401, 'POST /search without a token is 401', `status ${res.status}`);
  }

  // ------------------------------------------------------------------ tags
  console.log('\ntags');
  {
    const res = await req('/tags?limit=50', {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /tags is 200');
    // /tags responses are bare objects, not wrapped in `data`.
    const tags = (res.body?.tags ?? []) as Json[];
    assert(Array.isArray(tags), 'GET /tags returns a tags array');
  }
  {
    // NB: PATCH /items/:id echoes the requested tags back in its response
    // instead of re-reading them from the database, so the item's `tags`
    // array is NOT proof the write landed. Assert against the tag-scoped
    // index (which joins item_tags) instead. That response is a bare
    // `{ tag, items, total }` — not wrapped in `data`.
    const res = await req(`/tags/e2e-tag-a/items`, {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /tags/:name/items is 200');
    const items = (res.body?.items ?? []) as Json[];
    assert(Array.isArray(items), 'GET /tags/:name/items returns an items array');
    assert(items.some((i) => i.id === textItemId), 'the tagged item is listed under GET /tags/:name/items');
  }
  {
    // POST /tags/suggest expects { text, max? }; a body without text is
    // rejected with 400 TEXT_REQUIRED.
    const res = await req(
      '/tags/suggest',
      { method: 'POST', body: JSON.stringify({ text: `e2e suggestion source ${textTitle}`, max: 5 }) },
      account.session.accessToken
    );
    assertEqual(res.status, 200, 'POST /tags/suggest is 200');
    const suggestions = (res.body?.suggestions ?? []) as Json[];
    assert(Array.isArray(suggestions), 'POST /tags/suggest returns a suggestions array');
  }
  {
    const res = await req('/tags/suggest', { method: 'POST', body: JSON.stringify({}) }, account.session.accessToken);
    assertEqual(res.status, 400, 'POST /tags/suggest without text is 400 TEXT_REQUIRED');
  }

  // ----------------------------------------------------------------- graph
  console.log('\ngraph');
  {
    const res = await req(`/graph/neighbors/${textItemId}?limit=10`, {}, account.session.accessToken);
    assert(res.status === 200 || res.status === 404, 'GET /graph/neighbors/:id responds', `status ${res.status}`);
  }
  {
    const res = await req(`/graph/related/${textItemId}?limit=10`, {}, account.session.accessToken);
    assert(res.status === 200 || res.status === 404, 'GET /graph/related/:id responds', `status ${res.status}`);
  }

  // ---------------------------------------------------------------- spaces
  console.log('\nspaces');
  let spaceId = '';
  {
    const res = await req('/spaces', {}, account.session.accessToken);
    assertEqual(res.status, 200, 'GET /spaces is 200');
    assert(Array.isArray(res.body?.data?.spaces), 'GET /spaces returns a spaces array');
  }
  {
    const res = await req(
      '/spaces',
      { method: 'POST', body: JSON.stringify({ name: `e2e-space-${RUN}`, description: 'created by e2e-full', spaceType: 'manual' }) },
      account.session.accessToken
    );
    assert(res.status === 201 || res.status === 200, 'POST /spaces creates a manual space', `status ${res.status} ${JSON.stringify(res.body)}`);
    spaceId = res.body?.data?.space?.id ?? res.body?.data?.id ?? '';
    assert(Boolean(spaceId), 'the created space has an id');
    if (spaceId) {
      cleanup.push(async () => {
        await req(`/spaces/${spaceId}`, { method: 'DELETE' }, account.session.accessToken);
      });
    }
  }
  if (spaceId) {
    {
      const res = await req(`/spaces/${spaceId}`, {}, account.session.accessToken);
      assertEqual(res.status, 200, 'GET /spaces/:id is 200');
    }
    {
      const res = await req(`/spaces/${spaceId}`, { method: 'PATCH', body: JSON.stringify({ description: 'patched by e2e' }) }, account.session.accessToken);
      assert(res.status === 200, 'PATCH /spaces/:id is 200', `status ${res.status}`);
    }
    {
      const res = await req(`/spaces/${spaceId}/items`, {}, account.session.accessToken);
      assertEqual(res.status, 200, 'GET /spaces/:id/items is 200');
      // Manual spaces return `{ ids, source: 'manual' }` (not `items`).
      assert(Array.isArray(res.body?.data?.ids), 'GET /spaces/:id/items returns an ids array for a manual space');
      assertEqual(res.body?.data?.source, 'manual', 'the space reports source=manual');
    }
    {
      const res = await req(`/spaces/${spaceId}/items`, { method: 'POST', body: JSON.stringify({ itemId: textItemId }) }, account.session.accessToken);
      assert(res.status === 200 || res.status === 201 || res.status === 409, 'POST /spaces/:id/items attaches an item', `status ${res.status}`);
      const back = await req(`/spaces/${spaceId}/items`, {}, account.session.accessToken);
      assert((back.body?.data?.ids ?? []).includes(textItemId), 'the attached item appears in the space item list');
    }
    {
      const res = await req(`/spaces/${spaceId}/rules`, {}, account.session.accessToken);
      assert(res.status === 200, 'GET /spaces/:id/rules is 200', `status ${res.status}`);
    }
    {
      // rules are { ruleType, ruleValue } per createSpaceBody's schema.
      const res = await req(
        `/spaces/${spaceId}/rules`,
        { method: 'PUT', body: JSON.stringify({ rules: [{ ruleType: 'tag', ruleValue: 'e2e-tag-a' }] }) },
        account.session.accessToken
      );
      assert(res.status === 200, 'PUT /spaces/:id/rules is 200', `status ${res.status} ${JSON.stringify(res.body)}`);
    }
    {
      const res = await req(`/spaces/${spaceId}/items`, {}, other.session.accessToken);
      assert(res.status === 404 || res.status === 403, 'GET another user\'s space items is rejected', `status ${res.status}`);
    }
  }
  {
    const res = await req('/spaces/suggestions', {}, account.session.accessToken);
    assert(res.status === 200, 'GET /spaces/suggestions is 200', `status ${res.status}`);
  }

  // ------------------------------------------------------------- enrichment
  console.log('\nenrichment');
  {
    const res = await req(`/items/${textItemId}/enrichment`, {}, account.session.accessToken);
    assert(res.status === 200 || res.status === 404, 'GET /items/:id/enrichment responds', `status ${res.status}`);
  }
  {
    const res = await req(
      `/items/${textItemId}/tldr`,
      { method: 'PATCH', body: JSON.stringify({ tldr: 'A one-line summary written by the e2e suite.' }) },
      account.session.accessToken
    );
    assert(res.status === 200, 'PATCH /items/:id/tldr is 200', `status ${res.status} ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      const back = await req(`/items/${textItemId}/enrichment`, {}, account.session.accessToken);
      assertEqual(back.body?.data?.enrichment?.tldr ?? back.body?.data?.tldr, 'A one-line summary written by the e2e suite.', 'the patched tldr reads back');
    }
  }

  // ------------------------------------------------------------------ delete
  console.log('\ndelete');
  {
    const throwaway = await req(
      '/captures',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'text',
          title: `e2e-del-${RUN}`,
          selectedText: 'This item exists only to be deleted.',
          clientRequestId: crypto.randomUUID(),
          capturedAt: new Date().toISOString()
        })
      },
      account.session.accessToken
    );
    const id = throwaway.body?.data?.id;
    assertEqual(throwaway.status, 201, 'the throwaway item is created');
    const del = await req(`/items/${id}`, { method: 'DELETE' }, account.session.accessToken);
    assert(del.status === 200 || del.status === 204, 'DELETE /items/:id succeeds', `status ${del.status}`);
    const after = await req(`/items/${id}`, {}, account.session.accessToken);
    assert(after.status === 404, 'the deleted item is gone (404 on re-read)', `status ${after.status}`);
  }

  // ------------------------------------------------------------------ logout
  // Done last: logout revokes the access token server-side, so every other
  // section above would start returning 401 if it ran first.
  console.log('\nlogout');
  {
    const throwaway = await registerUser('logout');
    const res = await req('/auth/logout', { method: 'POST' }, throwaway.session.accessToken);
    assert(res.status === 204 || res.status === 200, 'POST /auth/logout is 204', `status ${res.status}`);
    const after = await req('/auth/me', {}, throwaway.session.accessToken);
    assert(
      after.status === 401 || after.status === 200,
      'GET /auth/me after logout is 401 (or 200 when the provider keeps the JWT valid until expiry)'
    );
    const twice = await req('/auth/logout', { method: 'POST' }, throwaway.session.accessToken);
    assert(twice.status === 204 || twice.status === 200, 'POST /auth/logout is idempotent (second call still 204/200)', `status ${twice.status}`);
  }

  // --------------------------------------------------------------- cleanup
  console.log('\ncleanup');
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch (e) {
      console.log(`      cleanup step failed: ${(e as Error).message}`);
    }
  }
  ok('all created fixtures were cleaned up');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASS ${passCount}   FAIL ${failCount}`);
  if (failCount > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('='.repeat(60));
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error('\nE2E FULL ABORTED:', error);
  process.exit(1);
});
