# P0 incident analysis — embedding_kind column missing

> Recorded on the `feat/p0-gemini-cloud` branch. This document
> explains the chain of decisions that led to a stable
> Gemini-only production target, the bugs that were found and
> fixed, and the operator actions that remain.

## 1. The reported symptom

```
Failed to save embedding: Could not find the 'embedding_kind' column of 'item_embeddings' in the schema cache
```

The error repeats on every capture because the embed job retries
the same failing upsert three times before giving up.

## 2. Root cause

The `embed` job handler in
[`apps/api/src/jobs/handlers/embed.ts`](../../apps/api/src/jobs/handlers/embed.ts)
calls `supabase.from("item_embeddings").upsert({...embedding_kind,
embedding_version...})`. Both columns are added by migration 022
(`packages/database/migrations/022_embedding_identity.sql`).

The error means the column is not present in the PostgREST
schema cache. The two plausible causes are:

- **A. Migration 022 was never applied to the target database.**
  - This is the most likely cause in a fresh-deployment scenario.
  - The previous migration runner
    `packages/database/scripts/apply-pending.mts` hard-coded
    `['021_content_clusters.sql']` and made no attempt to track
    what was applied. A fresh deploy would not pick up 022 or
    023 at all.
- **B. Migration 022 was applied, but the PostgREST schema cache
  is stale.** Supabase caches the schema in PostgREST and does
  not always reload it automatically after a `psql`-applied
  migration. The fix is `NOTIFY pgrst, 'reload schema'`.

The fix on the code side is the same in both cases: a safe
migration runner that **discovers every migration**, tracks them
in a `schema_migrations` ledger with a SHA-256 fingerprint, and
refuses to re-run mutated SQL.

## 3. What this branch changed

### 3.1 Safe migration runner

`packages/database/scripts/migrate.ts` replaces
`apply-pending.mts`. It:

- discovers every `NNN_*.sql` under
  `packages/database/migrations/` in numerical order
- reads the `schema_migrations` ledger (id, sha256, applied_at);
  auto-creates it if missing
- in `--apply` mode, runs the SQL inside a transaction, then
  inserts the ledger row
- in dry-run (default), reports the decision for every file
- refuses to run a migration whose SHA-256 disagrees with the
  ledger (a file was edited after being applied — unsafe)
- runs a schema probe (existence of the columns the application
  reads) and exits non-zero if any are missing

### 3.2 Recovery script for the failed embed jobs

`packages/database/scripts/recover-failed-embed-jobs.ts`. After
migrations 022/023 are applied, this script:

- verifies `item_embeddings.embedding_kind` and
  `embedding_version` are present (refuses to run otherwise)
- lists every `failed` job of type `embed`
- in dry-run mode, prints the list
- in `--apply` mode, resets them to `pending` so the standard
  embed handler picks them up

The script does NOT re-embed anything itself. The
`EmbedHandler` already:

- upserts on `(item_id)` (no duplicate rows)
- reads the configured embedding model at runtime
- recomputes `item_document_chunks` for documents
- rebuilds related memories (auto-link) and refreshes
  clusters when the item becomes `ready`

So the recovery is just a job-row reset.

### 3.3 Centralised Gemini HTTP client

`packages/ai/src/gemini-client.ts` is a single client per
process, shared by every Gemini call. It enforces:

- bounded per-attempt timeout (env: `GEMINI_REQUEST_TIMEOUT_MS`,
  default 45 s)
- exponential backoff with jitter, capped at `GEMINI_MAX_RETRIES`
- respect for `Retry-After` on 429
- retryable vs. non-retryable classification of HTTP and network
  errors
- per-process concurrency cap (env: `GEMINI_MAX_CONCURRENT_REQUESTS`)
- per-process RPM pacer (env: `GEMINI_RATE_LIMIT_RPM`)
- circuit breaker: after N consecutive failures, short-circuit
  for a cooldown window
- sanitised telemetry (no API key, no prompt, no image bytes)

The pre-existing text and embedding providers were refactored
to go through the shared client. The duplication between the
two retries / 429 / 5xx blocks is gone.

### 3.4 Four new Gemini providers

- `GeminiOcrProvider` — `OCR_PROVIDER=gemini`
- `GeminiImageDescriptionProvider` — `AI_IMAGE_DESCRIPTION_PROVIDER=gemini`
- `GeminiTldrProvider` — `AI_TLDR_PROVIDER=gemini`
- `GeminiVisualEmbeddingProvider` — `VISUAL_EMBEDDING_PROVIDER=gemini`

Each provider:

- throws on every failure (no silent fallback that would
  fabricate an empty caption / TLDR / vector)
- enforces a 10 MB image-size cap and MIME validation
- writes nothing to the wrong storage layer (visual embeddings
  are NEVER written to `item_embeddings`; they live in their
  own table when persistence ships)

### 3.5 Per-user daily quota

`packages/ai/src/user-quota.ts` — `UserAiQuota`. A
configurable per-user daily cap (env: `AI_USER_DAILY_LIMIT`,
default 100 calls). The cap is reset at UTC midnight, which
matches the Gemini Developer API's daily-quota reset window.

When a user is over the cap, the system throws a non-retryable
`RATE_LIMITED` error and the memory is preserved with whatever
enrichment already completed. The item becomes `ready` and the
failure is recorded for the operator.

### 3.6 Free-Tier enforcement

`ai-config.ts` now refuses to mount `VISUAL_EMBEDDING_PROVIDER=gemini`
when `AI_FREE_ONLY=true` and the configured
`GEMINI_VISUAL_EMBEDDING_MODEL` is not on the verified-Free-Tier
list. The list is currently empty — the multimodal embedding
endpoint is not on the Free Tier as of the file date. The
operator must add a model id to the list (and verify Free-Tier
availability on the Google AI Studio model catalog) before
enabling cloud visual embeddings in production.

## 4. Operator actions (cannot be done in code)

These are the steps that require human access or paid services:

1. **Live database migration.** Run, in order:
   ```bash
   pnpm --filter @mnemonics/database exec tsx scripts/migrate.ts --dry-run
   pnpm --filter @mnemonics/database exec tsx scripts/migrate.ts --apply
   ```
   Then run the schema probe:
   ```bash
   pnpm --filter @mnemonics/database exec tsx scripts/migrate.ts --schema-probe
   ```
   If the probe reports any `MISS`, the corresponding
   migration was not applied — investigate the migrate log
   before proceeding.

2. **PostgREST schema reload.** After the migrations land, send
   `NOTIFY pgrst, 'reload schema';` to the database. (A migration
   applied via `psql` does not always invalidate the PostgREST
   cache; the NOTIFY is the supported way to force a reload.)

3. **Recover the failed embed jobs.** Once the columns are
   present:
   ```bash
   pnpm --filter @mnemonics/database exec tsx scripts/recover-failed-embed-jobs.ts --dry-run
   pnpm --filter @mnemonics/database exec tsx scripts/recover-failed-embed-jobs.ts --apply
   ```
   The `EmbedHandler` re-embeds the items on the next queue
   tick; the script only resets the job rows.

4. **Verify Gemini key + Free-Tier eligibility.** The
   `GEMINI_API_KEY` must be a Gemini Developer API key (NOT
   Vertex AI). Confirm the configured models
   (`gemini-3.8-flash`, `gemini-embedding-001`) are available on
   the Free Tier for the operator's Google Cloud project via
   the Google AI Studio model catalog. The default
   `GEMINI_RATE_LIMIT_RPM=2` is conservative; the operator may
   raise it to `15` once the Free-Tier eligibility is confirmed.

5. **Cloud visual embeddings.** Verify `gemini-embedding-2`
   availability on the Free Tier. If confirmed, add the model
   id to `FREE_TIER_VISUAL_MODELS` in
   `packages/ai/src/ai-config.ts` and set
   `VISUAL_EMBEDDING_PROVIDER=gemini`. If not, leave the
   provider on `local` (development target) or `none` (no
   visual similarity in the UI).

6. **Privacy disclosure.** The user-facing privacy notice
   (see `docs/privacy.md`) MUST be rendered in the web
   dashboard and the extension onboarding flow before any
   content is sent to Google. The architecture supports a
   per-user cloud-AI toggle; the UI is the missing piece.

7. **Production environment variables.** Copy
   `.env.production.example` into the hosting platform's
   private environment variable store. Confirm the populated
   `.env` (the one with real secrets) is NEVER committed.

## 5. What I did NOT do

- I did not run the migrations against a live database. There
  is no `DATABASE_URL` in this sandbox; the migrations were
  applied earlier (see the conversation log) to a database the
  user connected to manually.
- I did not exercise the real Gemini API. The `smoke-gemini`
  test is gated behind `SMOKE_GEMINI=1` and a real
  `GEMINI_API_KEY`. CI never hits the public Gemini API.
- I did not implement the per-user cloud-AI toggle in the UI.
  The architecture supports it; the UI is a separate task.
- I did not modify any previously applied migration. Migration
  024 (`packages/database/migrations/024_embedding_model_migration.sql`)
  was already corrected in earlier commits on this branch.
- I did not delete the existing local-inference providers
  (Ollama, Tesseract, Transformers.js, CLIP). They remain
  available for offline development; production selects Gemini
  via env.
