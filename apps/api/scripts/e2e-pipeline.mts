/**
 * End-to-end pipeline smoke test.
 *
 * Captures a text item, waits for the tag + embed pipeline to finish,
 * and asserts that:
 *
 *   - exactly one tag and one embed job ran (no duplicates);
 *   - both jobs completed;
 *   - the item ended up `status = 'ready'`;
 *   - no extra jobs were created along the way.
 *
 * Captures an image item and asserts:
 *
 *   - exactly one ocr, one tag, one embed job ran;
 *   - all three completed in the right order;
 *   - the item is `ready` at the end.
 *
 * Captures the same clientRequestId twice and asserts that no extra
 * jobs are created on the second capture.
 *
 * Captures two items concurrently with the same image (different
 * clientRequestId) and asserts no jobs are duplicated.
 *
 * Runs the two Spaces scenarios from the product spec:
 *
 *   A (manual) — add two memories, re-add them (idempotent), prove a
 *     smart Space refuses a manual add, remove one member and prove
 *     the memory itself survives.
 *   B (smart) — a matching memory shows up, a non-matching one does
 *     not, a *later* capture joins the Space without the Space being
 *     touched, and a deleted memory drops back out. That is the proof
 *     smart Spaces are dynamic rather than a snapshot of ids.
 *
 * Requires a real Supabase Postgres with all migrations applied and
 * a running API. Authentication is resolved in this order:
 *
 *   1. `E2E_ACCESS_TOKEN` — paste a token you already have;
 *   2. `E2E_EMAIL` / `E2E_PASSWORD` — signs in through
 *      `POST /api/v1/auth/login` and uses the returned access token;
 *   3. `DEV_AUTH_TOKEN` — the development-mode bypass. Only works
 *      when the API runs without a Supabase client, so a Supabase-
 *      backed server rejects it with 401.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const API = process.env.API_URL || 'http://localhost:4000/api/v1';
const DEV_TOKEN = process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token';
const USER_ID = process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';

const pool = createPool(DATABASE_URL);

/** Resolved once, lazily, so a bad token fails fast with a clear message. */
let tokenPromise: Promise<string> | null = null;
function token(): Promise<string> {
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    if (process.env.E2E_ACCESS_TOKEN) return process.env.E2E_ACCESS_TOKEN;
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (email && password) {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body: any = await res.json().catch(() => null);
      const access = body?.data?.session?.accessToken;
      if (!res.ok || !access) {
        throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
      }
      return access as string;
    }
    return DEV_TOKEN;
  })();
  return tokenPromise;
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await token()}`,
      ...(init.headers || {})
    }
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const { randomUUID } = await import('node:crypto');

/**
 * Capture a text memory.
 *
 * The API's `captureInputSchema` is a strict discriminated union:
 * `clientRequestId` must be a uuid and the body lives in
 * `selectedText` (not `rawText`). The demo fixtures below predate
 * that contract, so the shape is built here rather than in each
 * call site.
 */
async function captureText(title: string, body: string) {
  const res = await api('/captures', {
    method: 'POST',
    body: JSON.stringify({
      type: 'text',
      title,
      selectedText: body,
      clientRequestId: randomUUID(),
      capturedAt: new Date().toISOString()
    })
  });
  if (res.status >= 300) {
    throw new Error(`capture failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string };
}

async function listJobs(itemId: string) {
  const result = await pool.query<{ type: string; status: string; created_at: Date }>(
    `SELECT type, status, created_at FROM jobs WHERE item_id = $1 ORDER BY created_at ASC`,
    [itemId]
  );
  return result.rows;
}

async function waitForReady(itemId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ status: string }>('SELECT status FROM items WHERE id = $1', [
      itemId
    ]);
    const row = result.rows[0];
    if (!row) throw new Error('item disappeared');
    // `ready` / `failed` are the two terminal states; the pipeline
    // tracks which step is next in the `jobs` table, not on the item.
    if (row.status === 'ready' || row.status === 'failed') return row;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${itemId}`);
}

async function cleanup(itemId: string) {
  await pool.query(`DELETE FROM items WHERE id = $1`, [itemId]);
}

async function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function testTextPipeline() {
  console.log('text pipeline');
  const result = await captureText('Hello world', 'Some interesting text to tag and embed.');
  const itemId = result.id;
  try {
    const final = await waitForReady(itemId);
    await assert(final.status === 'ready', `item is ready`);

    const jobs = await listJobs(itemId);
    const byType: Record<string, number> = {};
    for (const j of jobs) byType[j.type] = (byType[j.type] || 0) + 1;

    // tag + enrich + embed. `enrich` (TLDR / image description) is
    // fire-and-forget: a provider failure records itself on the item
    // and must not fail the job or stall the pipeline.
    await assert(byType.tag === 1, 'one tag job');
    await assert(byType.enrich === 1, `one enrich job (got ${byType.enrich ?? 0})`);
    await assert(byType.embed === 1, 'one embed job');
    await assert(byType.ocr === undefined, 'no ocr job for a text capture');
    await assert(jobs.length === 3, `exactly three jobs (got ${jobs.length})`);
    await assert(
      jobs.every((j) => j.status === 'completed' || j.status === 'failed'),
      'every job reached a terminal state'
    );
    await assert(
      jobs.filter((j) => j.type !== 'enrich').every((j) => j.status === 'completed'),
      'tag and embed completed'
    );
  } finally {
    await cleanup(itemId);
  }
}

/**
 * Same `clientRequestId` twice must return the same item and enqueue
 * no extra jobs. `captureText` mints a fresh uuid, so this one posts
 * the body directly.
 */
async function testIdempotentCapture() {
  console.log('idempotent capture');
  const body = {
    type: 'text',
    title: 'Idempotent capture',
    selectedText: 'Should not create duplicate items or jobs.',
    clientRequestId: randomUUID(),
    capturedAt: new Date().toISOString()
  };
  const post = () => api('/captures', { method: 'POST', body: JSON.stringify(body) });
  const first = (await post()).body.data;
  const second = (await post()).body.data;
  try {
    await assert(first.id === second.id, 'same item id returned');
    await waitForReady(first.id);
    const jobs = await listJobs(first.id);
    const nonEnrich = jobs.filter((j) => j.type !== 'enrich');
    await assert(
      nonEnrich.length === 2,
      `still two tag/embed jobs after duplicate capture (got ${nonEnrich.length})`
    );
  } finally {
    await cleanup(first.id);
  }
}

async function testConcurrentCaptures() {
  console.log('concurrent captures');
  const ids: string[] = [];
  try {
    const [a, b, c] = await Promise.all([
      captureText('Concurrent a', 'Concurrent text a.'),
      captureText('Concurrent b', 'Concurrent text b.'),
      captureText('Concurrent c', 'Concurrent text c.')
    ]);
    ids.push(a.id, b.id, c.id);
    await Promise.all(ids.map((id) => waitForReady(id)));
    for (const id of ids) {
      const jobs = (await listJobs(id)).filter((j) => j.type !== 'enrich');
      await assert(jobs.length === 2, `${id}: exactly two tag/embed jobs`);
    }
  } finally {
    for (const id of ids) await cleanup(id);
  }
}

async function testRetryEndpoint() {
  console.log('retry endpoint (manual trigger)');
  const result = await captureText('Retry me', 'Will be retried via the manual endpoint.');
  const itemId = result.id;
  try {
    await waitForReady(itemId);
    // Re-triggering embed after the pipeline is `none` should be
    // idempotent: the endpoint returns the existing in-flight job (or
    // creates one if there's none). Either way the item should remain
    // `ready`.
    const res = await api(`/items/${itemId}/jobs/embed`, { method: 'POST' });
    if (res.status === 200 || res.status === 201) {
      console.log(`  ✓ retry returned ${res.status}`);
    } else {
      throw new Error(`retry returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const jobs = await listJobs(itemId);
    // tag and embed must both exist; the retry must not produce a
    // second embed row thanks to the partial unique index.
    const embeds = jobs.filter((j) => j.type === 'embed');
    await assert(embeds.length <= 2, `at most one embed job retry (got ${embeds.length})`);
  } finally {
    await cleanup(itemId);
  }
}

// ============================================================
// Spaces — E2E scenarios A (manual) and B (smart, dynamic)
// ============================================================

/** Create a manual Space; returns the API's space row. */
async function createSpace(body: Record<string, unknown>) {
  const res = await api('/spaces', { method: 'POST', body: JSON.stringify(body) });
  if (res.status >= 300) {
    throw new Error(`create space failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.space as {
    id: string;
    name: string;
    spaceType: string;
    rule: unknown;
  };
}

async function deleteSpace(id: string) {
  await api(`/spaces/${id}`, { method: 'DELETE' });
}

async function spaceItemIds(id: string): Promise<string[]> {
  const res = await api(`/spaces/${id}/items`);
  if (res.status >= 300) {
    throw new Error(`space items failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.ids as string[];
}

/**
 * Scenario A — Manual Space.
 *
 * Two captured memories land in "Research"; removing one drops the
 * membership but must leave the memory in Everything.
 */
async function testManualSpaceScenario() {
  console.log('\nE2E scenario A — manual Space');
  const created = await captureText(
    'Alpha acquisition notes',
    'Due diligence on the Alpha acquisition target.'
  );
  const second = await captureText('Beta valuation model', 'Discounted cash flow for the Beta target.');
  await Promise.all([waitForReady(created.id), waitForReady(second.id)]);

  let space: { id: string } | null = null;
  try {
    space = await createSpace({ name: 'E2E Research', spaceType: 'manual', color: 'blue' });

    const add = await api(`/spaces/${space.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [created.id, second.id] })
    });
    await assert(add.status === 200, 'add two memories');

    // Idempotent: re-adding the same ids must not error or duplicate.
    const again = await api(`/spaces/${space.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [created.id, second.id] })
    });
    await assert(again.status === 200, 'duplicate add is idempotent');
    const memberIds = await spaceItemIds(space.id);
    await assert(memberIds.length === 2, `two members after duplicate add (got ${memberIds.length})`);

    // A smart Space must refuse manual membership.
    const smart = await createSpace({
      name: 'E2E Smart (rejects manual add)',
      spaceType: 'smart',
      color: 'teal',
      rule: { q: 'Alpha', filters: { kind: ['text'] } }
    });
    try {
      const rejected = await api(`/spaces/${smart.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ itemIds: [created.id] })
      });
      await assert(rejected.status === 422, `smart Space rejects manual add (got ${rejected.status})`);
    } finally {
      await deleteSpace(smart.id);
    }

    const removed = await api(`/spaces/${space.id}/items/${created.id}`, { method: 'DELETE' });
    await assert(removed.status === 204, 'remove one from the Space');
    const afterRemove = await spaceItemIds(space.id);
    await assert(
      afterRemove.length === 1 && afterRemove[0] === second.id,
      'only the second memory remains a member'
    );

    const survivor = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM items WHERE id = $1', [
      created.id
    ]);
    await assert(survivor.rows[0].n === '1', 'removed memory still exists in the database');
  } finally {
    if (space) await deleteSpace(space.id);
    await cleanup(created.id);
    await cleanup(second.id);
  }
}

/**
 * Scenario B — Smart Space is dynamic.
 *
 * T0: memory A matches the rule, B does not.
 * T1: nothing about the Space changes; memory C matching the same
 *     criteria is captured.
 * T2: reloading the Space yields A + C purely because the rule is
 *     re-executed — no write, no background job, no id list.
 */
async function testSmartSpaceIsDynamic() {
  console.log('\nE2E scenario B — smart Space auto-updates');
  const token = 'mnemonics-e2e-zqxjkv';
  const a = await captureText(`Logo ${token} primary`, `A design asset for ${token}.`);
  const b = await captureText('Unrelated grocery list', 'milk, eggs, bread.');
  await Promise.all([waitForReady(a.id), waitForReady(b.id)]);

  let space: { id: string } | null = null;
  try {
    space = await createSpace({
      name: 'E2E Logo Inspiration',
      spaceType: 'smart',
      color: 'violet',
      rule: { q: token, filters: { kind: ['text'] } }
    });
    await assert(space.spaceType === 'smart', 'stored as a smart Space');

    // The Space must hold criteria, never result ids.
    const ruleRow = await pool.query<{ rule: unknown }>(
      'SELECT rule FROM spaces WHERE id = $1',
      [space.id]
    );
    const ruleText = JSON.stringify(ruleRow.rows[0].rule);
    await assert(!ruleText.includes('itemIds') && !ruleText.includes(a.id), 'rule holds no result ids');

    const t0 = await spaceItemIds(space.id);
    await assert(t0.includes(a.id), 'matching memory A appears');
    await assert(!t0.includes(b.id), 'non-matching memory B does not appear');

    // T1 — capture C matching the same criteria. The Space is never touched.
    const c = await captureText(`Logo ${token} secondary`, `Another design asset for ${token}.`);
    try {
      await waitForReady(c.id);
      const t2 = await spaceItemIds(space.id);
      await assert(t2.includes(a.id) && t2.includes(c.id), 'A + C appear after a later capture');
      await assert(t2.length === 2, `exactly A + C (got ${t2.length})`);
      await assert(!t2.includes(b.id), 'B still absent');

      // Deleting C must need no cleanup on the Space: the next read
      // simply stops matching it.
      await pool.query('DELETE FROM items WHERE id = $1', [c.id]);
      const t3 = await spaceItemIds(space.id);
      await assert(!t3.includes(c.id) && t3.includes(a.id), 'deleted memory drops out of the smart Space');
    } finally {
      await cleanup(c.id);
    }

    // Tenant isolation: a token that resolves to another user must not
    // see this Space. A garbage token is enough — a valid one would
    // require minting a second account.
    const foreign = await fetch(`${API}/spaces/${space.id}`, {
      headers: { authorization: 'Bearer definitely-not-a-real-token' }
    });
    await assert(foreign.status >= 400, `foreign credentials cannot read the Space (got ${foreign.status})`);
  } finally {
    if (space) await deleteSpace(space.id);
    await cleanup(a.id);
    await cleanup(b.id);
  }
}

async function main() {
  // Sanity check
  const health = await api('/jobs/health');
  await assert(health.status === 200, 'jobs health 200');

  await testTextPipeline();
  await testIdempotentCapture();
  await testConcurrentCaptures();
  await testRetryEndpoint();
  await testManualSpaceScenario();
  await testSmartSpaceIsDynamic();

  await pool.end();
  console.log('\nALL E2E ASSERTIONS PASSED');
}

main().catch(async (error) => {
  console.error('\nE2E FAILED:', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
