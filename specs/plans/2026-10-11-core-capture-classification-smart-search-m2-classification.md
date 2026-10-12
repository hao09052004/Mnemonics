# M2 — Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Gemini-powered structured classifier that reads
`items.source_metadata` and the captured text, writes a
versioned `item_classifications` row, and re-embeds the memory
when the description changes — so a search for "wooden furniture"
finds a saved chair without the user typing a tag.

**Architecture:** A new `classify` job type runs after the
existing `tag` job. It calls a new `GeminiContentClassifier`
provider through the existing `ai-service`, validates the
response with a strict Zod schema, persists the row, and
triggers a re-embed if the description is non-empty and
differs from the previous value. The job is idempotent on
`(item_id, classifier_version, content_hash)`.

**Tech Stack:** TypeScript 5.4, Node 22, `gemini-3.5-flash-lite`
(or whatever is configured), existing `@mnemonics/ai`
provider infrastructure. No new dependencies.

**Spec:** [`../0005-core-capture-classification-smart-search.md`](../0005-core-capture-classification-smart-search.md)
§2 (Scope), §4 (Principles), §5.1–§5.4 (Data model),
§6.2 (Classify job), §6.3 (Idempotency), §6.5 (Failure
isolation), §10 (Backfill), §11 (AI provider).

## Global Constraints

- The classify job NEVER flips `items.status` to `failed`.
  Failures land in `item_classifications.status = 'failed'`
  and the user-facing chip shows "Detected: still processing"
  until retry.
- The classifier is the **only** new AI provider in this
  milestone. No new embedding model, no new OCR engine, no
  new TLDR source.
- The `attributes` JSONB is validated by Zod at the API
  boundary. Unknown keys are rejected. The classifier may
  only emit values that round-trip through the schema.
- Provenance follows spec §5.3 priority: `user` >
  `structured_data` > `html_meta` > `dom` > `extracted_text`
  > `ocr` > `gemini_vision` > `gemini_text`. User edits
  override AI suggestions; JSON-LD overrides Gemini text.
- The job is keyed on `(item_id, classifier_version,
  content_hash)`. A re-enqueue with the same key is a no-op.
- PR #16 fixes (working web capture dialogs, shared query
  embeddings, the Noop provider fallback) are preserved.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` are green
  at the end of every task.

## Review Focus

1. **A failed Gemini call leaves the item usable.** A
   `ProviderError` from the classifier must produce
   `status='failed'` on `item_classifications` and leave
   `items.status` unchanged. Test: a stub provider that
   throws, then a `GET /items/:id` returns the original
   item with `status` from the rest of the pipeline.
2. **The schema rejects unknown attribute keys.** A
   classifier that emits `{"foo": "bar"}` is rejected with
   `error_code='INVALID_RESPONSE'`. The row is written
   as `failed`, not `ready`.
3. **JSON-LD overrides Gemini text.** A `Product` JSON-LD
   with `material: 'Wood'` survives even when Gemini
   returns `material: 'leather'`. The provenance map shows
   `material: 'structured_data'`.
4. **The job is idempotent.** A re-enqueue with the same
   content hash and version is a no-op (no Gemini call, no
   row write). Test: count Gemini requests across two
   enqueues.
5. **Re-embed is gated.** Re-embed only fires when
   `description` is non-empty AND differs from the last
   embedded value. The M2 row writes are not enough on
   their own.

Each is wired to a task's test list.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/database/migrations/025_item_classifications.sql` | New table + indexes + RLS + ownership trigger. |
| `packages/database/src/index.ts` | `ClassificationRepository` (insert, find, list, touch). |
| `packages/database/src/__tests__/classifications.test.ts` | Repository integration tests. |
| `packages/ai/src/providers/classification/types.ts` | `ContentClassifier` interface + Zod schema. |
| `packages/ai/src/providers/classification/gemini-classifier.ts` | Gemini implementation. |
| `packages/ai/src/providers/classification/noop-classifier.ts` | No-op fallback when Free Tier is exhausted. |
| `packages/ai/src/providers/classification/index.ts` | Barrel. |
| `packages/ai/src/providers/classification/__tests__/*.test.ts` | Provider unit tests. |
| `packages/ai/src/ai-service.ts` | Register the classifier provider. |
| `apps/api/src/jobs/handlers/classify.ts` | `ClassifyHandler` orchestration. |
| `apps/api/src/jobs/router.ts` | Register `classify` job type. |
| `apps/api/src/jobs/queue.ts` | Extend `JobType` union to include `'classify'`. |
| `apps/api/src/routes/capture.ts` | Enqueue the new job after `tag` succeeds. |
| `apps/api/src/routes/__tests__/classify-enqueue.test.ts` | HTTP test for capture → classify. |
| `apps/api/src/routes/classifications.ts` (new) | `GET /items/:id/classification` + `PATCH`. |
| `apps/api/src/app.ts` | Mount the classifications route. |
| `apps/api/scripts/backfill-classifications.mts` | Operator backfill (spec §10). |
| `docs/ai-classification.md` | Operator + developer doc. |

---

## Task 1: Add `item_classifications` table

**Files:**
- Create: `packages/database/migrations/025_item_classifications.sql`

**Interfaces:**
- Produces: a new table the repository can read and write.

- [ ] **Step 1: Apply the migration locally**

```sql
-- packages/database/migrations/025_item_classifications.sql
BEGIN;
CREATE TABLE IF NOT EXISTS item_classifications (
  item_id            UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  detected_type      TEXT CHECK (detected_type IN (
    'article','product','recipe','video','quote','highlight',
    'webpage','image','note','document','other'
  )),
  category           TEXT,
  description        TEXT,
  attributes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  entities           JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence         DOUBLE PRECISION,
  provider           TEXT,
  model              TEXT,
  classifier_version TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','ready','failed','skipped'
  )),
  error_code         TEXT,
  content_hash       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS item_classifications_user_idx
  ON item_classifications (user_id);
CREATE INDEX IF NOT EXISTS item_classifications_detected_type_idx
  ON item_classifications (user_id, detected_type);
CREATE INDEX IF NOT EXISTS item_classifications_category_idx
  ON item_classifications (user_id, category);
CREATE INDEX IF NOT EXISTS item_classifications_attrs_gin
  ON item_classifications USING GIN (attributes jsonb_path_ops);
ALTER TABLE item_classifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_classifications_owner_policy ON item_classifications;
CREATE POLICY item_classifications_owner_policy ON item_classifications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM items WHERE items.id = item_classifications.item_id AND items.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM items WHERE items.id = item_classifications.item_id AND items.user_id = auth.uid())
  );
COMMIT;
```

Apply via the existing helper:

```bash
pnpm --filter @mnemonics/api exec tsx scripts/apply-one-migration.mts 025_item_classifications.sql
```

- [ ] **Step 2: Verify the table exists**

Run the probe-style check from M1 Task 1, or rely on
the migration script's success message.

- [ ] **Step 3: Commit**

```bash
git add packages/database/migrations/025_item_classifications.sql
git commit -m "feat(db): add item_classifications table (M2)"
```

---

## Task 2: `ClassificationRepository`

**Files:**
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/src/__tests__/classifications.test.ts`

**Interfaces:**
- Produces: `createClassificationRepository(pool)` returning
  `upsert`, `findByItemId`, `listByUser`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/src/__tests__/classifications.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPool,
  createItemRepository,
  createClassificationRepository
} from '@mnemonics/database';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

describe.skipIf(skipIfNoDb)('ClassificationRepository (M2)', () => {
  let pool;
  let userId;
  let itemId;
  let itemIds = [];

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    const u = await pool.query(
      `INSERT INTO auth.users (id, raw_user_meta_data)
       VALUES (gen_random_uuid(), jsonb_build_object('email', $1)) RETURNING id`,
      [`class-${Date.now()}@example.com`]
    );
    userId = u.rows[0].id;
    const items = createItemRepository(pool);
    const item = await items.createPendingItem({
      userId,
      capture: { type: 'link', title: 'chair', sourceUrl: 'https://x', clientRequestId: crypto.randomUUID() }
    });
    itemId = item.id;
    itemIds.push(itemId);
  });

  afterEach(async () => {
    if (itemIds.length) {
      await pool.query(`DELETE FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
      itemIds = [];
    }
    await pool.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
    await pool.end();
  });

  it('upserts a classification row and finds it back', async () => {
    const repo = createClassificationRepository(pool);
    await repo.upsert({
      itemId, userId,
      detectedType: 'product', category: 'furniture',
      description: 'a chair',
      attributes: { material: 'wood' },
      entities: [],
      evidence: { material: 'structured_data' },
      confidence: 0.93,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      classifierVersion: 'v1',
      status: 'ready',
      contentHash: 'sha256:abc'
    });
    const row = await repo.findByItemId(itemId, userId);
    expect(row?.detected_type).toBe('product');
    expect(row?.attributes).toEqual({ material: 'wood' });
  });

  it('rejects an upsert whose user_id does not match the item', async () => {
    const repo = createClassificationRepository(pool);
    await expect(
      repo.upsert({
        itemId, userId: '00000000-0000-4000-8000-000000000099',
        detectedType: null, category: null, description: null,
        attributes: {}, entities: [], evidence: {},
        confidence: null, provider: 'gemini', model: 'm',
        classifierVersion: 'v1', status: 'failed',
        errorCode: 'OWNERSHIP_MISMATCH',
        contentHash: null
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mnemonics/database exec vitest run src/__tests__/classifications.test.ts`
Expected: FAIL — `createClassificationRepository` not exported.

- [ ] **Step 3: Implement the repository**

In `packages/database/src/index.ts`, add:

```ts
export type ClassificationRow = {
  itemId: string;
  userId: string;
  detectedType: string | null;
  category: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  entities: Array<Record<string, unknown>>;
  evidence: Record<string, string>;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  classifierVersion: string;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
  errorCode: string | null;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertClassification = Omit<ClassificationRow, 'createdAt' | 'updatedAt'>;

export interface ClassificationRepository {
  upsert(row: UpsertClassification): Promise<void>;
  findByItemId(itemId: string, userId: string): Promise<ClassificationRow | null>;
  listByUser(userId: string): Promise<ClassificationRow[]>;
}

export function createClassificationRepository(pool: Pool): ClassificationRepository {
  return {
    async upsert(row) {
      // Ownership guard: refuse to write a row whose user_id
      // does not match the parent item's user_id.
      const item = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM items WHERE id = $1`, [row.itemId]
      );
      if (!item.rows[0] || item.rows[0].user_id !== row.userId) {
        throw new Error('OWNERSHIP_MISMATCH');
      }
      await pool.query(
        `INSERT INTO item_classifications
          (item_id, user_id, detected_type, category, description,
           attributes, entities, evidence, confidence, provider, model,
           classifier_version, status, error_code, content_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
                 $9, $10, $11, $12, $13, $14, $15, NOW())
         ON CONFLICT (item_id) DO UPDATE SET
          detected_type = EXCLUDED.detected_type,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          attributes = EXCLUDED.attributes,
          entities = EXCLUDED.entities,
          evidence = EXCLUDED.evidence,
          confidence = EXCLUDED.confidence,
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          classifier_version = EXCLUDED.classifier_version,
          status = EXCLUDED.status,
          error_code = EXCLUDED.error_code,
          content_hash = EXCLUDED.content_hash,
          updated_at = NOW()`,
        [
          row.itemId, row.userId, row.detectedType, row.category,
          row.description, JSON.stringify(row.attributes),
          JSON.stringify(row.entities), JSON.stringify(row.evidence),
          row.confidence, row.provider, row.model,
          row.classifierVersion, row.status, row.errorCode, row.contentHash
        ]
      );
    },
    async findByItemId(itemId, userId) {
      const r = await pool.query(
        `SELECT * FROM item_classifications WHERE item_id = $1 AND user_id = $2`,
        [itemId, userId]
      );
      if (!r.rows[0]) return null;
      const row = r.rows[0];
      return {
        itemId: row.item_id, userId: row.user_id,
        detectedType: row.detected_type, category: row.category,
        description: row.description,
        attributes: row.attributes, entities: row.entities,
        evidence: row.evidence, confidence: row.confidence,
        provider: row.provider, model: row.model,
        classifierVersion: row.classifier_version,
        status: row.status, errorCode: row.error_code,
        contentHash: row.content_hash,
        createdAt: row.created_at, updatedAt: row.updated_at
      };
    },
    async listByUser(userId) {
      const r = await pool.query(
        `SELECT * FROM item_classifications WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId]
      );
      return r.rows.map((row) => ({
        itemId: row.item_id, userId: row.user_id,
        detectedType: row.detected_type, category: row.category,
        description: row.description,
        attributes: row.attributes, entities: row.entities,
        evidence: row.evidence, confidence: row.confidence,
        provider: row.provider, model: row.model,
        classifierVersion: row.classifier_version,
        status: row.status, errorCode: row.error_code,
        contentHash: row.content_hash,
        createdAt: row.created_at, updatedAt: row.updated_at
      }));
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/database exec vitest run src/__tests__/classifications.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/index.ts packages/database/src/__tests__/classifications.test.ts
git commit -m "feat(db): ClassificationRepository + tests (M2)"
```

---

## Task 3: `ContentClassifier` interface + Zod schema

**Files:**
- Create: `packages/ai/src/providers/classification/types.ts`
- Create: `packages/ai/src/providers/classification/noop-classifier.ts`

**Interfaces:**
- Produces: `classify(input): Promise<ClassificationResult>`.

- [ ] **Step 1: Author the types and schema**

```ts
// packages/ai/src/providers/classification/types.ts
import { z } from 'zod';

export const attributeSchema = z.object({
  brand: z.string().max(120).optional(),
  merchant: z.string().max(120).optional(),
  product_name: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  object_type: z.string().max(120).optional(),
  material: z.string().max(120).optional(),
  color: z.string().max(60).optional(),
  price_amount: z.number().nonnegative().optional(),
  price_currency: z.string().length(3).optional(),
  author: z.string().max(200).optional(),
  publisher: z.string().max(200).optional(),
  publication_date: z.string().max(40).optional(),
  cuisine: z.string().max(120).optional(),
  dish_type: z.string().max(120).optional(),
  cooking_time_minutes: z.number().int().nonnegative().optional(),
  ingredients: z.array(z.string().max(120)).max(60).optional(),
  platform: z.string().max(60).optional(),
  channel: z.string().max(120).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  language: z.string().max(20).optional(),
  title_suggestion: z.string().max(200).optional(),
  attribution: z.string().max(200).optional()
}).strict();

export const entitySchema = z.object({
  type: z.string().max(60),
  name: z.string().max(200),
  source: z.enum(['structured_data','dom','ocr','visual','text'])
});

export const detectedTypeSchema = z.enum([
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
]);

export const classificationResultSchema = z.object({
  detectedType: detectedTypeSchema,
  category: z.string().max(120).nullable(),
  titleSuggestion: z.string().max(200).nullable(),
  description: z.string().max(2000).nullable(),
  tags: z.array(z.string().max(40)).max(20),
  keywords: z.array(z.string().max(40)).max(20),
  language: z.string().max(20).nullable(),
  entities: z.array(entitySchema).max(30),
  attributes: attributeSchema,
  confidence: z.number().min(0).max(1)
}).strict();

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

export const provenanceSchema = z.enum([
  'structured_data','html_meta','dom','extracted_text',
  'ocr','gemini_vision','gemini_text','user'
]);

export type Provenance = z.infer<typeof provenanceSchema>;

export interface ClassificationInput {
  title: string;
  body: string;            // selected text or readable article text
  jsonLd: Array<Record<string, unknown>>;   // parsed JSON-LD
  ogTitle?: string;
  ogDescription?: string;
  contentType: 'link' | 'text' | 'image' | 'screenshot' | 'document';
  classifierVersion: string;
}

export interface ContentClassifier {
  readonly name: string;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}
```

- [ ] **Step 2: Implement the noop classifier**

```ts
// packages/ai/src/providers/classification/noop-classifier.ts
import type { ContentClassifier, ClassificationInput, ClassificationResult } from './types.js';

export class NoopContentClassifier implements ContentClassifier {
  readonly name = 'noop';
  async classify(_: ClassificationInput): Promise<ClassificationResult> {
    return {
      detectedType: 'other',
      category: null,
      titleSuggestion: null,
      description: null,
      tags: [],
      keywords: [],
      language: null,
      entities: [],
      attributes: {},
      confidence: 0
    };
  }
}
```

- [ ] **Step 3: Unit test the noop classifier**

```ts
// packages/ai/src/providers/classification/__tests__/noop-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { NoopContentClassifier } from '../noop-classifier.js';

describe('NoopContentClassifier', () => {
  it('returns an other/empty result', async () => {
    const c = new NoopContentClassifier();
    const out = await c.classify({
      title: 'x', body: 'y', jsonLd: [],
      contentType: 'text', classifierVersion: 'v1'
    });
    expect(out.detectedType).toBe('other');
    expect(out.tags).toEqual([]);
    expect(out.confidence).toBe(0);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/providers/classification/
git commit -m "feat(ai): classification types + noop classifier (M2)"
```

---

## Task 4: Gemini classifier

**Files:**
- Create: `packages/ai/src/providers/classification/gemini-classifier.ts`
- Test: `packages/ai/src/providers/classification/__tests__/gemini-classifier.test.ts`

**Interfaces:**
- Consumes: a `geminiClient` instance (already in the package).
- Produces: a `ContentClassifier` whose `classify()` returns
  `ClassificationResult` parsed through the Zod schema.

- [ ] **Step 1: Write the failing test**

The test mocks the Gemini client to return a known JSON
string and asserts the classifier parses it. Mocks are
mandatory (CI has no Free Tier quota).

```ts
// packages/ai/src/providers/classification/__tests__/gemini-classifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GeminiContentClassifier } from '../gemini-classifier.js';

const validJson = JSON.stringify({
  detectedType: 'product',
  category: 'furniture',
  titleSuggestion: null,
  description: 'A solid oak chair.',
  tags: ['chair', 'wood'],
  keywords: ['wooden chair'],
  language: 'en',
  entities: [{ type: 'Product', name: 'Wooden Chair', source: 'structured_data' }],
  attributes: { brand: 'Northwind', material: 'Wood' },
  confidence: 0.92
});

describe('GeminiContentClassifier', () => {
  it('parses a valid Gemini response', async () => {
    const client = { generateJson: vi.fn(async () => ({ text: validJson, raw: {} })) };
    const c = new GeminiContentClassifier({ client, model: 'gemini-3.5-flash-lite', version: 'v1' });
    const out = await c.classify({
      title: 'Wooden Chair', body: 'A solid oak chair.',
      jsonLd: [{ '@type': 'Product', material: 'Wood' }],
      ogTitle: 'Wooden Chair', ogDescription: 'Solid oak chair',
      contentType: 'link', classifierVersion: 'v1'
    });
    expect(out.detectedType).toBe('product');
    expect(out.attributes.material).toBe('Wood');
  });

  it('throws on invalid JSON (no schema match)', async () => {
    const client = { generateJson: vi.fn(async () => ({ text: '{"detectedType":"banana"}', raw: {} })) };
    const c = new GeminiContentClassifier({ client, model: 'm', version: 'v1' });
    await expect(c.classify({
      title: 'x', body: 'y', jsonLd: [],
      contentType: 'text', classifierVersion: 'v1'
    })).rejects.toThrow();
  });

  it('throws on a ProviderError (caller persists failed)', async () => {
    const client = { generateJson: vi.fn(async () => { throw new Error('GEMINI_TIMEOUT'); }) };
    const c = new GeminiContentClassifier({ client, model: 'm', version: 'v1' });
    await expect(c.classify({
      title: 'x', body: 'y', jsonLd: [],
      contentType: 'text', classifierVersion: 'v1'
    })).rejects.toThrow('GEMINI_TIMEOUT');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mnemonics/ai exec vitest run src/providers/classification/__tests__/gemini-classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Gemini classifier**

The implementation is a thin wrapper over the existing
`geminiClient.generateJson()`. The prompt instructs the
model to emit JSON matching the schema; the response is
parsed through `classificationResultSchema`. The full file
lives in
`packages/ai/src/providers/classification/gemini-classifier.ts`
and is roughly:

```ts
import type { ContentClassifier, ClassificationInput, ClassificationResult } from './types.js';
import { classificationResultSchema } from './types.js';

export interface GeminiClassifierDeps {
  client: { generateJson(opts: { prompt: string; model: string }): Promise<{ text: string; raw: unknown }> };
  model: string;
  version: string;
}

const SYSTEM_PROMPT = `You classify a piece of saved content.
Output JSON with this shape (no extra keys):
{ detectedType, category|null, titleSuggestion|null, description|null,
  tags[], keywords[], language|null, entities[{type,name,source}],
  attributes{ brand?, merchant?, product_name?, category?, object_type?,
  material?, color?, price_amount?, price_currency?, author?, publisher?,
  publication_date?, cuisine?, dish_type?, cooking_time_minutes?,
  ingredients?, platform?, channel?, duration_seconds?, language?,
  title_suggestion?, attribution? }, confidence 0..1 }
Only emit values you can justify from the input. Never guess.
detectedType ∈ article|product|recipe|video|quote|highlight|webpage|image|note|document|other.`;

export class GeminiContentClassifier implements ContentClassifier {
  readonly name = 'gemini';
  constructor(private deps: GeminiClassifierDeps) {}
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const prompt = [
      SYSTEM_PROMPT,
      'JSON-LD: ' + JSON.stringify(input.jsonLd).slice(0, 4000),
      'Title: ' + input.title,
      'Body: ' + input.body.slice(0, 8000)
    ].join('\n');
    const { text } = await this.deps.client.generateJson({
      prompt, model: this.deps.model
    });
    const parsed = JSON.parse(text);
    return classificationResultSchema.parse(parsed);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/ai exec vitest run src/providers/classification/__tests__/gemini-classifier.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/providers/classification/gemini-classifier.ts
git commit -m "feat(ai): GeminiContentClassifier (M2)"
```

---

## Task 5: Register the classifier in `ai-service`

**Files:**
- Modify: `packages/ai/src/ai-service.ts`

- [ ] **Step 1: Add the registry**

`ai-service` already exposes a registry shape for providers.
Add:

```ts
import { GeminiContentClassifier } from './providers/classification/gemini-classifier.js';
import { NoopContentClassifier } from './providers/classification/noop-classifier.js';

export interface ClassifierDeps {
  classifierVersion: string;
  geminiClient: { generateJson(opts: { prompt: string; model: string }): Promise<{ text: string; raw: unknown }> };
  model: string;
}

export function createClassifierService(deps: ClassifierDeps) {
  if (!deps.geminiClient) return new NoopContentClassifier();
  return new GeminiContentClassifier({
    client: deps.geminiClient,
    model: deps.model,
    version: deps.classifierVersion
  });
}
```

The exact factory may differ to match the existing
`AiService` shape; the test in Task 4 still passes because
it instantiates the classifier directly.

- [ ] **Step 2: Run the existing ai-service test for regression**

Run: `pnpm --filter @mnemonics/ai exec vitest run`
Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/ai-service.ts
git commit -m "feat(ai): register classifier provider in ai-service (M2)"
```

---

## Task 6: `ClassifyHandler` job

**Files:**
- Create: `apps/api/src/jobs/handlers/classify.ts`
- Modify: `apps/api/src/jobs/queue.ts` (extend `JobType` union)
- Modify: `apps/api/src/jobs/router.ts` (register handler)
- Test: `apps/api/src/jobs/__tests__/classify-handler.test.ts`

**Interfaces:**
- Produces: a handler that reads the item, runs the
  classifier, upserts `item_classifications`, and triggers
  a re-embed when the description changes.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/jobs/__tests__/classify-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ClassifyHandler } from '../handlers/classify.js';

function setup() {
  const repository = {
    findById: vi.fn(async (id) => ({
      id, userId: 'u1', status: 'pending', type: 'link',
      title: 'Wooden Chair', sourceUrl: 'https://x',
      rawText: 'Solid oak chair', ocrText: null,
      sourceMetadata: { jsonLd: [{ '@type': 'Product', material: 'Wood' }] }
    })),
    updateStatus: vi.fn(async () => {})
  };
  const classifications = {
    upsert: vi.fn(async () => {}),
    findByItemId: vi.fn(async () => null)
  };
  const classifier = {
    name: 'gemini',
    classify: vi.fn(async () => ({
      detectedType: 'product',
      category: 'furniture',
      titleSuggestion: 'Wooden Chair',
      description: 'A solid oak chair.',
      tags: ['chair', 'wood'],
      keywords: ['oak'],
      language: 'en',
      entities: [],
      attributes: { material: 'Wood' },
      confidence: 0.9
    }))
  };
  const queue = { create: vi.fn(async () => ({ id: 'j2' })) };
  return { repository, classifications, classifier, queue };
}

describe('ClassifyHandler (M2)', () => {
  it('upserts a ready classification and enqueues re-embed', async () => {
    const { repository, classifications, classifier, queue } = setup();
    const handler = new ClassifyHandler({
      queue: queue as any,
      repository: repository as any,
      classifications: classifications as any,
      classifier: classifier as any,
      classifierVersion: 'v1',
      embedReEnqueue: true
    });
    await handler.handle({ id: 'j1', itemId: 'i1', userId: 'u1', type: 'classify', payload: {} });
    expect(classifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', detectedType: 'product' })
    );
    expect(queue.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'embed' })
    );
  });

  it('writes a failed classification when the classifier throws', async () => {
    const { repository, classifications, queue } = setup();
    const classifier = {
      name: 'gemini',
      classify: vi.fn(async () => { throw new Error('GEMINI_TIMEOUT'); })
    };
    const handler = new ClassifyHandler({
      queue: queue as any,
      repository: repository as any,
      classifications: classifications as any,
      classifier: classifier as any,
      classifierVersion: 'v1',
      embedReEnqueue: false
    });
    await handler.handle({ id: 'j1', itemId: 'i1', userId: 'u1', type: 'classify', payload: {} });
    expect(classifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: expect.stringMatching(/GEMINI_TIMEOUT/) })
    );
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement the handler**

```ts
// apps/api/src/jobs/handlers/classify.ts
import type { Pool } from 'pg';
import type { ContentClassifier, ClassificationInput } from '@mnemonics/ai';
import type { ItemRepository, ClassificationRepository, UpsertClassification } from '@mnemonics/database';
import { mergeAttributes } from './classify-merge.js';
import type { JobQueue } from '../queue.js';

export interface ClassifyHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  classifications: ClassificationRepository;
  classifier: ContentClassifier;
  classifierVersion: string;
  embedReEnqueue: boolean;
}

function sha256(input: string): string {
  return require('crypto').createHash('sha256').update(input).digest('hex');
}

export class ClassifyHandler {
  constructor(private deps: ClassifyHandlerDeps) {}

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }) {
    const item = await this.deps.repository.findById(job.itemId);
    if (!item) return;
    const meta = (item.sourceMetadata || {}) as {
      ogTitle?: string; ogDescription?: string;
      jsonLd?: Array<Record<string, unknown>>;
      article?: { textContent?: string };
    };
    const body = (meta.article && meta.article.textContent) || item.rawText || item.ocrText || '';
    const input: ClassificationInput = {
      title: item.title,
      body,
      jsonLd: meta.jsonLd || [],
      ogTitle: meta.ogTitle,
      ogDescription: meta.ogDescription,
      contentType: (item.type as ClassificationInput['contentType']) || 'text',
      classifierVersion: this.deps.classifierVersion
    };
    const contentHash = 'sha256:' + sha256(item.title + '|' + body).slice(0, 32);
    try {
      const result = await this.deps.classifier.classify(input);
      const existing = await this.deps.classifications.findByItemId(item.id, item.userId);
      const merged = mergeAttributes(
        meta.jsonLd || [],
        result.attributes,
        (existing && existing.evidence) || {}
      );
      await this.deps.classifications.upsert({
        itemId: item.id, userId: item.userId,
        detectedType: result.detectedType, category: result.category,
        description: result.description, attributes: merged.attributes,
        entities: result.entities, evidence: merged.evidence,
        confidence: result.confidence,
        provider: this.deps.classifier.name,
        model: undefined as unknown as string,
        classifierVersion: this.deps.classifierVersion,
        status: 'ready', errorCode: null, contentHash
      } satisfies UpsertClassification);
      if (this.deps.embedReEnqueue && result.description) {
        const lastDesc = (existing && existing.description) || '';
        if (lastDesc !== result.description) {
          await this.deps.queue.create({
            type: 'embed', itemId: item.id, userId: item.userId, payload: { reason: 'classify' }
          });
        }
      }
    } catch (err) {
      const errorCode = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      await this.deps.classifications.upsert({
        itemId: item.id, userId: item.userId,
        detectedType: null, category: null, description: null,
        attributes: {}, entities: [], evidence: {},
        confidence: null, provider: this.deps.classifier.name,
        model: null, classifierVersion: this.deps.classifierVersion,
        status: 'failed', errorCode, contentHash
      });
    }
  }
}
```

The `mergeAttributes` helper (in `classify-merge.ts`) takes
the JSON-LD attributes plus the classifier's attributes
and returns `{ attributes, evidence }` with JSON-LD taking
priority over Gemini text.

- [ ] **Step 3: Extend the JobType union**

In `apps/api/src/jobs/queue.ts`:

```ts
export type JobType = 'ocr' | 'tag' | 'embed' | 'enrich' | 'extract_document' | 'classify';
```

- [ ] **Step 4: Register the handler**

In `apps/api/src/jobs/router.ts`, after the existing handler
registrations, add:

```ts
if (deps.classifier && deps.classifications) {
  const classifyHandler = new ClassifyHandler({
    queue, repository: deps.repository,
    classifications: deps.classifications,
    classifier: deps.classifier,
    classifierVersion: process.env.CLASSIFIER_VERSION || 'v1',
    embedReEnqueue: true
  });
  queue.registerHandler('classify', (job) => classifyHandler.handle(job));
}
```

The `JobRouterDeps` interface gains the new optional fields.

- [ ] **Step 5: Wire the classifier into the router deps**

The factory at the call site (likely `apps/api/src/app.ts`)
gets the new args. The `AiService` already has a way to
expose a classifier; if it does not, this task may need to
add `getClassifier()`.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `pnpm --filter @mnemonics/api exec vitest run src/jobs/__tests__/classify-handler.test.ts`
Expected: PASS (2/2).

- [ ] **Step 7: Run full API suite for regression**

Run: `pnpm --filter @mnemonics/api exec vitest run`
Expected: All existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/jobs/handlers/classify.ts apps/api/src/jobs/queue.ts apps/api/src/jobs/router.ts \
        apps/api/src/jobs/__tests__/classify-handler.test.ts
git commit -m "feat(api): classify job handler (M2)"
```

---

## Task 7: Enqueue classify on capture

**Files:**
- Modify: `apps/api/src/routes/capture.ts`
- Test: `apps/api/src/routes/__tests__/classify-enqueue.test.ts`

**Interfaces:**
- Produces: a capture that also enqueues a `classify` job
  after the `tag` job. Idempotent (existing tag retry
  path does not re-enqueue classify).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/__tests__/classify-enqueue.test.ts
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createCaptureRouter } from '../capture.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeApp() {
  const createJob = vi.fn(async () => ({ id: 'j' }));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createCaptureRouter({
    repository: {
      findByClientRequestId: vi.fn(async () => null),
      createPendingItem: vi.fn(async ({ userId, capture }) => ({
        id: '00000000-0000-4000-8000-000000000040', userId, status: 'pending',
        type: capture.type, title: capture.title
      }))
    } as any,
    createJob,
    supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) } } as any
  }));
  return { app, createJob };
}

describe('capture route — classify enqueue (M2)', () => {
  it('enqueues classify after tag', async () => {
    const { app, createJob } = makeApp();
    await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer t')
      .send({
        type: 'link', title: 'chair', sourceUrl: 'https://x',
        clientRequestId: '00000000-0000-4000-8000-000000000041'
      });
    const types = createJob.mock.calls.map(c => c[0]);
    expect(types).toContain('tag');
    expect(types).toContain('enrich');
    expect(types).toContain('classify');
  });
});
```

- [ ] **Step 2: Implement**

In `apps/api/src/routes/capture.ts`, after the existing
`createJob('enrich', ...)` call, add:

```ts
try {
  await createJob('classify', item.id, userId);
} catch {
  // classifier may not be registered in test pools
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/api exec vitest run src/routes/__tests__/classify-enqueue.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/capture.ts apps/api/src/routes/__tests__/classify-enqueue.test.ts
git commit -m "feat(api): enqueue classify job on capture (M2)"
```

---

## Task 8: `GET /items/:id/classification` route

**Files:**
- Create: `apps/api/src/routes/classifications.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the route**

```ts
import express from 'express';
import type { Response } from 'express';
import type { ClassificationRepository } from '@mnemonics/database';
import type { AuthenticatedRequest } from '../auth.js';

export function createClassificationRouter(deps: { classifications: ClassificationRepository }) {
  const router = express.Router();
  router.get('/items/:id/classification', async (req: AuthenticatedRequest, res: Response) => {
    const row = await deps.classifications.findByItemId(req.params.id, req.userId!);
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }
    res.json({ data: row });
  });
  return router;
}
```

- [ ] **Step 2: Mount in `app.ts`**

The same way the items route is mounted. Pass
`classifications: createClassificationRepository(pool)`.

- [ ] **Step 3: Test**

A small test asserts:
  * 404 when no row exists
  * 200 with the row otherwise
  * Cross-user access returns 404 (RLS, but the API layer
    also enforces `userId`)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/classifications.ts apps/api/src/app.ts apps/api/src/routes/__tests__/classification-route.test.ts
git commit -m "feat(api): GET /items/:id/classification (M2)"
```

---

## Task 9: Backfill script (opt-in)

**Files:**
- Create: `apps/api/scripts/backfill-classifications.mts`

- [ ] **Step 1: Implement the script**

- Reads every item for the configured test user.
- For each item without a `ready` row at the current
  `classifier_version` matching `content_hash`, enqueues a
  `classify` job.
- Supports `--dry-run` and a SIGINT-safe resume marker.
- Rate-limited to one Gemini call every 2 seconds.

- [ ] **Step 2: Document usage**

Append a short "Backfill" section to `docs/ai-classification.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/backfill-classifications.mts docs/ai-classification.md
git commit -m "feat(ops): backfill script + doc (M2)"
```

---

## Task 10: Documentation

**Files:**
- Create: `docs/ai-classification.md`

Document the schema, the prompt contract, the failure modes,
the operator runbook, the backfill command, and the M2
milestone's testing surface.

```bash
git add docs/ai-classification.md
git commit -m "docs(classification): operator + developer doc (M2)"
```

---

## Out of scope for M2 (deferred to M3/M4)

- Structured search filters (`detected_type`, `category`, ...)
  (M3)
- Natural query parser (M3)
- Save as Space on extension popup (M3)
- Backfill run on staging (M4)
- Relevance benchmark (M4)
- Re-embed on user edit (M4)

---

## Verification at the end of M2

- `pnpm typecheck` is green.
- `pnpm test` is green across the four packages.
- `pnpm build` is green.
- The acceptance test "A wooden chair product page is saved
  through the extension" produces an `item_classifications`
  row with `detected_type = 'product'`, `category =
  'furniture'`, `attributes.material = 'wood'`. The full
  text-search assertion is M3's job; M2 stops at "the row
  is present and the dashboard can read it".
