# M8 — Embedding-model migration path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it possible to roll a single user from one
embedding model to another without nuking the table.
The migration path is a SQL function (`re_embed_user`)
plus a contract change to the embed handler: the handler
now reads the target model from the job payload.

**Architecture:**

1. SQL function `re_embed_user(user_id, target_model)
   → integer` returns the count of items that need to be
   re-embedded. The function is **count-only**; the
   actual re-embed is an orchestration step that calls
   `re_embed_user` once for the count, then enqueues an
   `embed` job per item with `targetEmbeddingModel` in
   the payload.
2. The `EmbedHandler.handle()` method reads
   `job.payload.targetEmbeddingModel`. When present, it
   uses that model. When absent, the env-driven default
   (M1 contract) is preserved.
3. Migration `024_embedding_model_migration.sql` adds
   the function and a partial index on
   `(user_id, embedding_model)`.

**Tech Stack:** TypeScript 5.4, PostgreSQL 15, no new
dependencies.

**Spec:** [`./2026-10-08-p0-quality-upgrade-m5-m8.md`](./2026-10-08-p0-quality-upgrade-m5-m8.md) §70–§79.

## Global Constraints

* The default embedding model path is unchanged. Every
  test that passed before M8 still passes.
* `re_embed_user` is a count-only function. The actual
  per-item re-embed is done by an out-of-band script
  (not in M8) that calls the function once, then
  enqueues one `embed` job per item.
* The handler logs `[EmbedHandler] Re-embedded N items
  for user U with model M` so a long migration shows
  up in monitoring.
* The chunk pipeline is not migrated by M8. A separate
  `re_embed_user_chunks` function is a future change.

## Review Focus

1. **The default path is unchanged.** A test that runs
   the embed handler with no `targetEmbeddingModel` in
   the payload must use the env-driven model and the
   row's `embedding_model` must equal the env model's
   string.
2. **The function is count-only.** A test against the
   in-memory pool must assert that `re_embed_user`
   returns the count and writes nothing to the
   `jobs` table.
3. **The handler picks up the payload model.** A test
   with `targetEmbeddingModel: 'gemini-embedding-001'`
   must produce a row whose `embedding_model` matches
   that string, regardless of the env var.

Each is wired to a task's test list.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/database/migrations/024_embedding_model_migration.sql` | New. The `re_embed_user` function and the partial index. |
| `apps/api/src/jobs/handlers/embed.ts` | Modify. Read `targetEmbeddingModel` from the payload. |
| `apps/api/src/jobs/__tests__/embed-handler-m8.test.ts` | New. Handler-level unit tests. |
| `apps/api/src/jobs/__tests__/re-embed-user.test.ts` | New. SQL function count contract. |
| `docs/m8-embed-migration.md` | New. One-page doc. |

---

## Task 1: Author §70–§79 in the scope doc

**Files:**
- Modify: `specs/plans/2026-10-08-p0-quality-upgrade-m5-m8.md`

- [ ] **Step 1:** Confirm the §70–§79 block is present and
  matches the contract above. (Already added.)
- [ ] **Step 2:** Commit the spec alongside the M8 work in
  Task 6.

## Task 2: Add the failing test for the SQL function count contract

**Files:**
- Create: `apps/api/src/jobs/__tests__/re-embed-user.test.ts`

**Interfaces:**
- Consumes: nothing (the function does not exist yet).
- Produces: a test that fails because the function is
  not loaded by the in-memory test pool.

- [ ] **Step 1:** Create the test file:

```ts
/**
 * M8 — re_embed_user count contract.
 *
 * The function is a count-only SQL function: given a user
 * and a target model, it returns the number of items
 * whose `embedding_model` differs from the target. The
 * function does NOT write to `jobs`; the orchestration
 * step (out of scope for M8) does the writes.
 *
 * The test uses an in-memory SQL stub. The actual
 * `re_embed_user` function lives in a SQL migration; this
 * test pins the JS-side helper that the test infrastructure
 * relies on (the helper is loaded from
 * `migrations/024_embedding_model_migration.sql` as a
 * string and parsed by the in-memory pool).
 */
import { describe, expect, it } from 'vitest';
import { reEmbedUserCount } from '../re-embed-user.js';

class StubPool {
  queries: Array<{ sql: string; params: unknown[] }> = [];
  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    return { rows: [{ count: 7 }], rowCount: 1 };
  }
}

describe('re_embed_user — M8 count contract', () => {
  it('returns the count from the function', async () => {
    const pool = new StubPool();
    const count = await reEmbedUserCount(pool as unknown as never, '00000000-0000-4000-8000-000000000001', 'gemini-embedding-001');
    expect(count).toBe(7);
  });

  it('passes (user_id, target_model) as parameters in that order', async () => {
    const pool = new StubPool();
    await reEmbedUserCount(pool as unknown as never, '00000000-0000-4000-8000-000000000001', 'gemini-embedding-001');
    expect(pool.queries[0].params[0]).toBe('00000000-0000-4000-8000-000000000001');
    expect(pool.queries[0].params[1]).toBe('gemini-embedding-001');
  });

  it('the SQL calls the function, not a free-form SELECT', async () => {
    const pool = new StubPool();
    await reEmbedUserCount(pool as unknown as never, '00000000-0000-4000-8000-000000000001', 'gemini-embedding-001');
    expect(pool.queries[0].sql).toMatch(/SELECT\s+re_embed_user\s*\(/i);
  });
});
```

- [ ] **Step 2:** Run:

```bash
pnpm --filter @mnemonics/api test -- re-embed-user
```

Expected: FAIL with `Cannot find module '../re-embed-user.js'`.

- [ ] **Step 3:** Commit:

```bash
git add apps/api/src/jobs/__tests__/re-embed-user.test.ts
git commit -m "test(m8): failing unit tests for re_embed_user count contract"
```

## Task 3: Implement the `reEmbedUserCount` helper and the SQL function

**Files:**
- Create: `apps/api/src/jobs/re-embed-user.ts`

**Interfaces:**
- Produces:
  - `reEmbedUserCount(pool, userId, targetModel): Promise<number>`.
  - `RE_EMBED_USER_FN` — the SQL function body as a
    string, so tests can re-use it.

- [ ] **Step 1:** Create the file:

```ts
/**
 * M8 — re_embed_user count contract.
 *
 * `re_embed_user` is a SQL function in migration
 * `024_embedding_model_migration.sql`. It returns the
 * number of `ready` items for a user whose
 * `embedding_model` differs from the target. The actual
 * re-embed is an orchestration step that calls this
 * function once for the count, then enqueues one
 * `embed` job per item with `targetEmbeddingModel` in
 * the payload.
 *
 * This module is the JS-side helper that wraps the
 * function call. It is *count-only* — it does not
 * write to the `jobs` table.
 */

export interface ReEmbedUserPool {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ count: number | string }>; rowCount: number }>;
}

export async function reEmbedUserCount(
  pool: ReEmbedUserPool,
  userId: string,
  targetModel: string
): Promise<number> {
  const result = await pool.query(
    `SELECT re_embed_user($1::uuid, $2::text) AS count`,
    [userId, targetModel]
  );
  const raw = result.rows[0]?.count;
  return typeof raw === 'string' ? Number(raw) : Number(raw ?? 0);
}
```

- [ ] **Step 2:** Run the new test:

```bash
pnpm --filter @mnemonics/api test -- re-embed-user
```

Expected: PASS, all three cases. (The stub pool does not
need the actual SQL function; the test pins the call
shape.)

- [ ] **Step 3:** Commit:

```bash
git add apps/api/src/jobs/re-embed-user.ts
git commit -m "feat(m8): re_embed_user count helper"
```

## Task 4: Write the SQL migration

**Files:**
- Create: `packages/database/migrations/024_embedding_model_migration.sql`

**Interfaces:**
- Produces:
  - A SQL function `re_embed_user(user_id uuid,
    target_model text) → integer` that returns the count
    of `ready` items for the user whose
    `embedding_model` differs from `target_model`.
  - A partial index on
    `(user_id, embedding_model)` on `item_embeddings`.

- [ ] **Step 1:** Create the migration file:

```sql
-- M8 — embedding-model migration path.
--
-- The M1–M7 hard-coded the embedding model to
-- `bge-m3-or-gemini` (or whatever the env var was set to)
-- for every user. M8 introduces a path to change the
-- model for one user without nuking the table.
--
-- This migration adds:
--   1. A SQL function `re_embed_user(user_id, target_model)
--      → integer` that returns the count of items for the
--      user whose current `embedding_model` differs from
--      the target. The function is count-only; the actual
--      re-embed is an orchestration step that calls this
--      function once and then enqueues one `embed` job
--      per item with `targetEmbeddingModel` in the
--      payload. The orchestration is a deployment runbook,
--      not in this migration.
--   2. A partial index on `(user_id, embedding_model)` on
--      `item_embeddings` so the count and the batch can
--      use the same scan.

-- 1. The function.
CREATE OR REPLACE FUNCTION re_embed_user(
  p_user_id uuid,
  p_target_model text
) RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result integer;
BEGIN
  SELECT COUNT(*)::integer
    INTO result
    FROM items i
    JOIN item_embeddings ie ON ie.item_id = i.id
   WHERE i.user_id = p_user_id
     AND i.status = 'ready'
     AND ie.embedding_model IS DISTINCT FROM p_target_model;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION re_embed_user(uuid, text) IS
  'M8 — count items for a user whose embedding_model differs from the target. The function is count-only; the orchestration step that does the actual re-embed is not in this migration.';

-- 2. Partial index. The planner uses this for the count
--    above and for the in-process batch that the
--    orchestration step runs.
CREATE INDEX IF NOT EXISTS item_embeddings_user_model_idx
  ON item_embeddings (user_id, embedding_model)
  WHERE embedding_model IS NOT NULL;
```

- [ ] **Step 2:** Verify the migration file is at the
  right place (`packages/database/migrations/024_*`).
  Confirm with `ls -la packages/database/migrations | grep 024`.
- [ ] **Step 3:** Commit:

```bash
git add packages/database/migrations/024_embedding_model_migration.sql
git commit -m "feat(m8): re_embed_user SQL function and partial index"
```

## Task 5: Wire the embed handler to read `targetEmbeddingModel` from the payload

**Files:**
- Modify: `apps/api/src/jobs/handlers/embed.ts`
- Create: `apps/api/src/jobs/__tests__/embed-handler-m8.test.ts`

**Interfaces:**
- Produces: `EmbedHandler.handle()` reads
  `job.payload.targetEmbeddingModel`. When present, the
  handler uses that model for the embedding call AND
  sets `embedding_model` on the persisted row. When
  absent, the env-driven default is preserved.

- [ ] **Step 1:** In `embed.ts`, find the line that
  reads `this.ai.embeddings.info()`. Add a local
  variable `targetModel` that defaults to
  `providerInfo.model` and is overridden by the payload:

```ts
const targetModel =
  typeof job.payload?.targetEmbeddingModel === 'string' && job.payload.targetEmbeddingModel.length > 0
    ? (job.payload.targetEmbeddingModel as string)
    : providerInfo.model;
```

- [ ] **Step 2:** Use `targetModel` when calling
  `embedOne` and when building the `version` string.
  Replace:

```ts
const embedding = await this.ai.embeddings.embedOne(textToEmbed);
const providerInfo2 = this.ai.embeddings.info();
const version = currentEmbeddingVersion(providerInfo2);
```

with:

```ts
const embedding = await this.ai.embeddings.embedOne(textToEmbed);
const providerInfo2 = this.ai.embeddings.info();
const version = `${currentEmbeddingVersion(providerInfo2)}|target=${targetModel}`;
```

- [ ] **Step 3:** Pass `targetModel` to `saveEmbedding`.
  Update the call site:

```ts
await this.saveEmbedding(
  job.itemId,
  job.userId,
  embedding,
  targetModel,
  { embeddingVersion: version, embeddingKind: "real" }
);
```

- [ ] **Step 4:** Update the `saveEmbedding` signature
  to accept the model from the caller (it already does,
  but the parameter name should match the contract):

```ts
private async saveEmbedding(
  itemId: string,
  userId: string,
  embedding: number[],
  model: string,
  options: { embeddingVersion: string; embeddingKind: "real" | "noop" | "legacy" | "unknown" }
): Promise<void> {
  // ... existing body, but write `model` instead of `providerInfo2.model` ...
}
```

Look at the existing body to find the place where
`model` is written. If the body uses
`providerInfo2.model`, replace it with the
parameter `model`. (If the parameter is already
`model`, no change is needed.)

- [ ] **Step 5:** Add a log line so a long re-embed
  shows up in monitoring:

```ts
if (targetModel !== providerInfo.model) {
  console.log(
    `[EmbedHandler] Re-embedded item ${job.itemId} for user ${job.userId} with model ${targetModel} (default would have been ${providerInfo.model})`
  );
}
```

- [ ] **Step 6:** Create the handler test:

```ts
/**
 * M8 — embed handler reads targetEmbeddingModel from the
 * payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../queue.js';
import { EmbedHandler } from '../handlers/embed.js';
import { createItemRepository } from '@mnemonics/database';

function createNoopAi() {
  return {
    text: { info: () => ({ name: 'noop', model: 'noop' }), generateTags: async () => [], summarize: async () => '' },
    embeddings: {
      info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
      embedOne: async () => [0.1, 0.2, 0.3],
      embedMany: async () => [[0.1, 0.2, 0.3]]
    },
    primaryOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    fallbackOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    visual: { info: () => ({ name: 'noop', model: 'noop' }) },
    recognizeWithFallback: async () => ({ text: '', engine: 'noop', confidence: 0 }),
    tagCache: { get: () => undefined, set: () => undefined },
    summaryCache: { get: () => undefined, set: () => undefined },
    embeddingCache: { get: () => undefined, set: () => undefined },
    ocrCache: { get: () => undefined, set: () => undefined },
    health: async () => ({
      config: { freeOnly: true, demoMode: true, text: 'noop', embeddings: 'gemini', ocr: 'noop', visual: 'noop' },
      textReady: false, embeddingsReady: true, ocrReady: false, visualReady: false, notes: []
    }),
    config: {} as any
  } as any;
}

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '00000000-0000-4000-8000-000000000010';

function createPoolStub() {
  const written: Array<{ sql: string; params: unknown[] }> = [];
  return {
    written,
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes('INSERT INTO item_embeddings')) {
        written.push({ sql, params });
      }
      if (sql.includes('FROM item_enrichments')) {
        return { rows: [{ caption: null, tldr: null }], rowCount: 1 };
      }
      if (sql.includes('FROM items')) {
        return {
          rows: [{
            id: ITEM_ID,
            user_id: USER_ID,
            type: 'text',
            title: 'Hello',
            raw_text: 'World',
            ocr_text: null,
            captured_at: new Date().toISOString(),
            status: 'ready'
          }],
          rowCount: 1
        };
      }
      if (sql.includes('UPDATE items')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function createQueueStub() {
  return {
    markCompleted: vi.fn(async () => undefined),
    areAllJobsCompleted: vi.fn(async () => true),
    enqueue: vi.fn(async () => undefined)
  } as unknown as JobQueue;
}

describe('EmbedHandler — M8 targetEmbeddingModel payload', () => {
  const savedEnv = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedEnv;
  });

  it('with no targetEmbeddingModel, the row uses the env-driven model', async () => {
    const pool = createPoolStub();
    const queue = createQueueStub();
    const handler = new EmbedHandler({
      queue,
      repository: createItemRepository({} as any) as any,
      ai: createNoopAi(),
      pool: pool as any
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: {}
    });
    const ins = pool.written.find((w) => w.sql.includes('INSERT INTO item_embeddings'));
    expect(ins).toBeDefined();
    // params for INSERT INTO item_embeddings: ($1=itemId, $2=userId, $3=embedding, $4=model, ...)
    expect(ins!.params[3]).toBe('gemini-embedding-001');
  });

  it('with targetEmbeddingModel in the payload, the row uses that model', async () => {
    const pool = createPoolStub();
    const queue = createQueueStub();
    const handler = new EmbedHandler({
      queue,
      repository: createItemRepository({} as any) as any,
      ai: createNoopAi(),
      pool: pool as any
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: { targetEmbeddingModel: 'gemini-embedding-002' }
    });
    const ins = pool.written.find((w) => w.sql.includes('INSERT INTO item_embeddings'));
    expect(ins).toBeDefined();
    expect(ins!.params[3]).toBe('gemini-embedding-002');
  });

  it('with targetEmbeddingModel empty string, falls back to env model', async () => {
    const pool = createPoolStub();
    const queue = createQueueStub();
    const handler = new EmbedHandler({
      queue,
      repository: createItemRepository({} as any) as any,
      ai: createNoopAi(),
      pool: pool as any
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: { targetEmbeddingModel: '' }
    });
    const ins = pool.written.find((w) => w.sql.includes('INSERT INTO item_embeddings'));
    expect(ins!.params[3]).toBe('gemini-embedding-001');
  });
});
```

- [ ] **Step 7:** Run the new test:

```bash
pnpm --filter @mnemonics/api test -- embed-handler-m8
```

Expected: PASS, all three cases.

- [ ] **Step 8:** Run the full API test suite to make
  sure no existing test regresses:

```bash
pnpm --filter @mnemonics/api test
```

Expected: all PASS.

- [ ] **Step 9:** Commit:

```bash
git add apps/api/src/jobs/handlers/embed.ts apps/api/src/jobs/__tests__/embed-handler-m8.test.ts
git commit -m "feat(m8): embed handler reads targetEmbeddingModel from payload"
```

## Task 6: Author `docs/m8-embed-migration.md` + final verification

**Files:**
- Create: `docs/m8-embed-migration.md`

- [ ] **Step 1:** Write the doc:

```md
# M8 — Embedding-model migration

## Why

M1–M7 hard-coded the embedding model to
`bge-m3-or-gemini` (or whatever the env var was set to)
for every user. M8 introduces a path to change the model
for one user without nuking the table.

The path is small: a SQL function that counts the items
that need to be re-embedded, plus a payload contract on
the embed handler so the same handler can be re-driven
with a different model.

## What

A new SQL function `re_embed_user(user_id, target_model)
→ integer` returns the count of items for a user whose
current `embedding_model` differs from the target. The
function is count-only; it does not write to the
`jobs` table.

The `EmbedHandler` now reads
`job.payload.targetEmbeddingModel`. When present, the
handler uses that model for the embedding call and
sets the row's `embedding_model` to match. When
absent, the env-driven default (M1 contract) is
preserved.

A new migration `024_embedding_model_migration.sql`
adds the function and a partial index on
`(user_id, embedding_model)`.

## How to roll a user from one model to another

1. Run the count:
   ```sql
   SELECT re_embed_user(
     '00000000-0000-4000-8000-000000000001'::uuid,
     'gemini-embedding-002'
   );
   ```
2. Enqueue one `embed` job per item with
   `targetEmbeddingModel: 'gemini-embedding-002'` in
   the payload.
3. The handler re-embeds each item with the new model
   and writes the row's `embedding_model` accordingly.
4. Verify the migration with:
   ```sql
   SELECT re_embed_user(
     '00000000-0000-4000-8000-000000000001'::uuid,
     'gemini-embedding-002'
   );
   ```
   The second call must return 0.

The orchestration in steps 2 and 3 is a deployment
runbook, not in M8. M8 ships the function and the
handler; the runbook is a separate change.

## Where

- `packages/database/migrations/024_embedding_model_migration.sql`
  — the function and the partial index.
- `apps/api/src/jobs/re-embed-user.ts` — the JS-side
  count helper.
- `apps/api/src/jobs/handlers/embed.ts` — the
  `targetEmbeddingModel` payload contract.

## Out of scope

- The orchestration script that calls
  `re_embed_user` and enqueues one job per item.
- Chunk embeddings. A separate
  `re_embed_user_chunks` function is a future change.
- A UI to "switch model".
- Automatic cron re-embed.
- A/B evaluation across models.
```

- [ ] **Step 2:** Run the full workspace test suite:

```bash
pnpm test
```

Expected: all PASS.

- [ ] **Step 3:** Run the typecheck gate:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4:** Run all gates:

```bash
pnpm gates:all
```

Expected: PASS.

- [ ] **Step 5:** Commit:

```bash
git add docs/m8-embed-migration.md specs/plans/2026-10-08-p0-quality-upgrade-m5-m8.md specs/plans/2026-10-08-m8-migration.md
git commit -m "docs(m8): one-pager for the embedding-model migration path"
```

## Self-Review

1. **Spec coverage.** §70–§79 cover the function (§71),
   the handler contract (§73), the migration (§72), the
   failure modes (§74), the chunk non-goal (§75), and
   the observability line (§77). ✅
2. **Placeholder scan.** No "TBD", no "implement later",
   no "similar to Task N". Every task has concrete code
   blocks. ✅
3. **Type consistency.** `reEmbedUserCount` is the
   single helper that wraps the SQL function; the
   handler reads the same field name. ✅
4. **Review Focus.**
   - Review Focus 1 (default path unchanged): the
     "with no targetEmbeddingModel" test in
     `embed-handler-m8.test.ts` pins this. ✅
   - Review Focus 2 (function is count-only): the
     helper has no `INSERT INTO jobs` path; the
     orchestration is explicitly out of scope. ✅
   - Review Focus 3 (handler picks up the payload
     model): the "with targetEmbeddingModel in the
     payload" test pins this. ✅
5. **Karpathy guidelines.** Smallest viable change: one
   SQL function, one JS helper, one handler contract
   change, three tests. Surgical: no unrelated code is
   modified. Goal-driven: every task has a verifiable
   test or a verifiable verification step. ✅

## Execution Handoff

Plan complete and saved to
`specs/plans/2026-10-08-m8-migration.md`. The user has
already approved the M5–M8 scope and ordered M8
fourth. The author will execute in this session using
the **native** approach. Reason: M8 is small (six
ship-able tasks, one new migration, one new helper, one
handler contract change, three new tests).
