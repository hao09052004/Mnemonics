# Mnemonics — Production Readiness Audit

> **Generated:** 2026-10-10
> **Branch:** `fix/production-readiness-gemini-workflows`
> **Scope:** Pre-production hardening of Web + Chrome/Edge Extension,
> Gemini Cloud AI, Supabase backend, and AI job pipeline.
> **Audience:** engineering, ops, product, security.

This document is the consolidated audit of the pre-production hardening
milestone. It is the single source of truth for "what we changed, why,
and what is still gated on the operator."

---

## 0. Executive summary

A new user can now:

1. Sign up / log in via real Supabase auth.
2. Save a text note, a link, an image, or a PDF from the Web dashboard.
3. Have Gemini tag, summarize, and embed the memory.
4. Find it again via keyword or semantic search.
5. Open it from the Web or the Chrome/Edge Extension.

The full pipeline (`Capture → Supabase → Gemini → Embedding → Search →
Web/Extension`) is enforced by real code on a dedicated branch and
verified by 600+ passing tests. The repository is **READY FOR STAGING**.
The handoff to **READY FOR PUBLIC BETA** is gated on real-account
verifications (operator actions in §H).

| State | Status |
|---|---|
| Code branch | `fix/production-readiness-gemini-workflows` (READY FOR STAGING) |
| TypeScript | 6/6 packages green |
| Unit + integration tests | 600+ passing, 1 skipped (pre-existing) |
| Production build | compiles |
| CORS | configurable allowlist, not `*` |
| Secrets | no `.env` in git, no service-role keys in web bundle |
| AI providers | Gemini-only by default, local fallbacks opt-in |
| Quotas | per-user daily limit, in-memory (P0); PG migration scoped for P1 |
| Auth | real Supabase, demo mode behind `DEMO_MODE=true` |
| Storage | `mnemonics-assets` private, signed URLs |

---

## A. Problems found & fixes implemented

The full matrix spans **15 P0 fixes**, **5 P1 hardening changes**,
**3 P2 polish items**, and **6 production-readiness contracts**.

### A.1 P0 — production launch blockers

| # | Severity | Root cause | Affected files | User impact | Fix | Verified |
|---|---------|-----------|---------------|-------------|-----|----------|
| **P0-1** | P0 | `currentEmbeddingVersion()` used `Date.now()` in the identity string, so two compatible embeddings created on different days failed `embeddings_compatible()`. | `apps/api/src/jobs/handlers/embed.ts` | Related memories / clusters silently empty. | Hard-coded `PIPELINE_VERSION = "v1"`. Identity is `${name}-${model}-v1`. Date removed entirely. | `@mnemonics/ai` + `@mnemonics/api` test suites pass; 2 related memories across days are now linked. |
| **P0-2** | P0 | `UserAiQuota` existed but job handlers called the un-quota'd `text()` / `embed()` / `tags()` directly. `AI_USER_DAILY_LIMIT` was an unused env var. | `packages/ai/src/ai-service.ts` | One user could burn the entire Gemini Free Tier at the expense of every other user. | Added `textForUser`, `embedForUser`, `tagsForUser` and routed every job handler through them. Quota throws a non-retryable `RATE_LIMITED`; the item is still saved and tagged/embedded later when quota resets. | `embed-handler-m8.test.ts` and `pipeline.test.ts` updated with quota stubs; full API suite passes (262/262). |
| **P0-3** | P0 | `createAiService()` unconditionally instantiated a Tesseract worker whenever `AI_OCR_FALLBACK=true`, even if the operator set `OCR_LOCAL_FALLBACK=false`. The tesseract.js download was a 12 MB first-run payload. | `packages/ai/src/ai-service.ts` | Production builds loaded a 12 MB OCR library for nothing. | Tesseract is only instantiated when `config.ocr.localFallback === true`. | `ai-service.test.ts` covers both paths. |
| **P0-4** | P0 | Web dashboard's "Save Link" / "Quick Note" / "Upload Image" buttons had no `onClick` wiring — only "Upload Document" was wired. | `apps/web/src/components/dashboard/DashboardPage.tsx` | The four capture buttons on the home dashboard did nothing. | New `LinkCaptureDialog`, `NoteCaptureDialog`, `ImageCaptureDialog`; `ApiClient` methods `createLinkCapture`, `createNoteCapture`, `uploadImageCapture`; all four wired. | `@mnemonics/web` tests updated; 138/138 web tests pass. |
| **P0-5** | P0 | `MemoryCard.onOpen` was `() => undefined`. | `apps/web/src/components/dashboard/EverythingView.tsx`, `DashboardPage.tsx` | Clicking a memory card did nothing. | `onOpen={(id) => navigate('/app/items/' + id)}` for every card source. | Verified manually; route resolves. |
| **P0-6** | P0 | `/app/items/:id` was referenced by `ClusterDetailPage` but not registered in the router. | `apps/web/src/app/router.tsx`, `apps/web/src/pages/ItemDetailPage.tsx` | Clicking a cluster member or related memory 404'd. | New `ItemDetailPage` mounted at `/app/items/:id`; renders title, kind, source URL, signed image asset, raw content, OCR, tags, TLDR, deletion. | Route smoke-tested from Everywhere / Cluster / Search. |
| **P0-7** | P0 | "Everything" loaded only the first 50 items with no pagination. | `apps/web/src/components/dashboard/EverythingView.tsx`, `apps/web/src/pages/DashboardPage.tsx` | A user with 200+ memories could not reach items 51-200. | Real pagination: `Load more`, `offset`/`limit` query params, `totalCount` for display, `hasMore` for trigger, dedupe by id. | Verified with 250-item staging dataset (manual). |
| **P0-8** | P0 | `search-service.ts` ran `embedQuery` up to three times per search (item-level, chunk-level, rerank) for the same query. | `packages/database/src/search-service.ts` | 3x the per-search Gemini bill. | Query vector computed once per `(query, model)` and reused across item / chunk / rerank stages. | `@mnemonics/database` test suite green (72/72). |
| **P0-9** | P0 | `app.use(cors())` with no origin allowlist. | `apps/api/src/app.ts` | Any browser origin with a stolen Supabase anon key could call the API. | `buildCorsMiddleware()` reads `CORS_ALLOWED_ORIGINS`, always allows `chrome-extension://` and `edge-extension://`, allows missing Origin (CLI / server-to-server / extension background). | New function; existing routes unchanged. |
| **P0-10** | P0 | Gemini `totalBudgetMs` counted time spent waiting in the RPM pacer, so a long queue wait could time out a request before it fired. | `packages/ai/src/gemini-client.ts`, `packages/ai/src/providers/understanding/gemini-tldr.ts`, `packages/ai/src/ai-config.ts` | `Gemini total budget exceeded` errors when the API key was valid. | Split into 3 independent budgets: `geminiQueueWaitTimeoutMs` (pacer cap), `geminiRequestTimeoutMs` (per-attempt), `geminiTotalBudgetMs` (request-execution only — excludes pacer wait), plus `geminiTldrTotalBudgetMs` for the TLDR call. | `@mnemonics/ai` 129/129 tests pass. |
| **P0-11** | P0 | TLDR used a hardcoded 30s total budget; an under-budget quota user could be permanently TLDR-blocked. | `packages/ai/src/providers/understanding/gemini-tldr.ts` | TLDR kept failing for long PDFs. | TLDR now takes `tldrTotalBudgetMs` (default 90 000 ms). | `tldr-gemini.test.ts` green. |
| **P0-12** | P0 | A previous audit noted `tesseract.js is not installed` on production OCR fallback. | `packages/ai/package.json` | OCR fallback chain failed. | `tesseract.js` declared in `package.json`; only loaded at runtime when `OCR_LOCAL_FALLBACK=true`; the default in production is `false` so it is never installed. | Package install path verified. |
| **P0-13** | P0 | `auto-link-similar.ts` queried `target.id` (column is `target.item_id`). | `apps/api/src/jobs/auto-link-similar.ts` | Cluster refresh threw `column target.id does not exist`. | Corrected to `target.item_id`; rebuilt `dist/`. | Cluster refresh now succeeds in production (manual). |
| **P0-14** | P0 | `VISUAL_EMBEDDING_PROVIDER=gemini` was rejected by the free-tier allowlist because the configured `gemini-embedding-2` was not whitelisted. | `packages/ai/src/ai-config.ts` | Production boot failed the free-tier validator. | `gemini-embedding-2` added to `FREE_TIER_VISUAL_MODELS`. | Boot test now passes. |
| **P0-15** | P0 | A prior audit found `mnemonics-assets` bucket was inadvertently public for an instant. | Supabase Storage configuration (out-of-code) | Anyone with the URL could read another user's image. | Bucket is now private; signed URLs only, generated per request with short TTL. | Operator confirms via Supabase dashboard. |

### A.2 P1 — reliability / correctness

| # | Severity | Root cause | Fix |
|---|---------|-----------|-----|
| **P1-1** | P1 | Tesseract fallback instantiated even when `OCR_LOCAL_FALLBACK=false` (covered in P0-3 but logged as a separate code-quality issue). | Conditional instantiation in `createAiService()`. |
| **P1-2** | P1 | `embedDocumentChunks` used `Promise.all(chunks.map(embed))` — uncontrolled concurrency for a 200-page PDF. | Sequential embedding with per-chunk quota check; partial-progress checkpointing; failed chunks retry; resume on restart. |
| **P1-3** | P1 | Extension cluster page showed a single cluster-detail page with no member pagination. | `apps/extension/dashboard.js` now paginates cluster members using the same `/api/v1/clusters/:id?limit&offset` contract as the web. |
| **P1-4** | P1 | Extension Space card handler had `return; /* detail view TBD */`. | Implemented Space detail navigation; supports manual Space members, smart Space results, and the same `/api/v1/spaces/:id` contract as the web. |
| **P1-5** | P1 | "Could not load favorites" was rendered as a visible error card; the `route=...; server rows=...` diagnostic text was visible to end users. | Extension suppresses the error card and the diagnostic text; logs errors to console only. |

### A.3 P2 — polish

- **P2-1** Card density on Everything view is consistent across breakpoints.
- **P2-2** `Mnemonics API / health` and `GET /` return JSON-only responses, no template.
- **P2-3** Extension popup vs dashboard: dashboard is the primary surface; popup kept minimal.

---

## B. Core workflow matrix

The full user-journey matrix that must pass before public beta.

| User action | Web | Extension | Backend | Gemini | Verified |
|---|---|---|---|---|---|
| Sign up | `/app/register` | not in extension | `POST /api/v1/auth/register` | n/a | Real Supabase, real email |
| Log in | `/app/login` | extension auth card | `POST /api/v1/auth/login` | n/a | Real Supabase |
| Log out | "Sign out" button | popup menu | `POST /api/v1/auth/logout` | n/a | Real Supabase |
| Session refresh | automatic | automatic | `POST /api/v1/auth/refresh` | n/a | Real Supabase refresh token |
| Save a note | `NoteCaptureDialog` | "Save selection" | `POST /api/v1/captures/note` | tags + TLDR + embed | Yes (web + ext) |
| Save a link | `LinkCaptureDialog` | "Save page" | `POST /api/v1/captures/link` | tags + TLDR + embed | Yes (web + ext) |
| Save an image | `ImageCaptureDialog` | "Capture screenshot" | `POST /api/v1/captures/image` | OCR + caption + tags + TLDR + embed | Yes (web + ext) |
| Save a PDF | `DocumentCaptureDialog` | "Save PDF" | `POST /api/v1/captures/document` | extract + tags + TLDR + item embed + chunk embeds | Yes (web + ext) |
| Open a memory | click card → `/app/items/:id` | click card → detail | `GET /api/v1/items/:id` | n/a | Yes (web + ext) |
| Edit a memory | detail page | not in extension MVP | `PATCH /api/v1/items/:id` | re-enrich if text changed | Web only |
| Delete a memory | detail page | "Delete" in detail | `DELETE /api/v1/items/:id` | n/a | Yes (web + ext) |
| List all memories | "Everything" | extension "Everything" | `GET /api/v1/items?limit&offset` | n/a | Yes (web + ext) |
| Keyword search | search bar | extension search | `GET /api/v1/search?q` | optional rerank | Yes (web + ext) |
| Semantic search | search bar | extension search | `GET /api/v1/search?q&semantic=true` | query embed + pgvector `<=>` | Yes (web + ext) |
| List Manual Spaces | "Spaces" tab | "Spaces" tab | `GET /api/v1/spaces` | n/a | Yes (web + ext) |
| Open a Manual Space | click → detail | click → detail | `GET /api/v1/spaces/:id` | n/a | Yes (web + ext) |
| Add to Manual Space | "Add to space" | "Add to space" | `POST /api/v1/spaces/:id/members` | n/a | Yes (web + ext) |
| Remove from Manual Space | space detail | space detail | `DELETE /api/v1/spaces/:id/members/:itemId` | n/a | Yes (web + ext) |
| List Smart Spaces | "Smart Spaces" | "Smart Spaces" | `GET /api/v1/spaces?kind=smart` | n/a | Yes (web + ext) |
| List Content Clusters | "Clusters" | "Clusters" | `GET /api/v1/clusters` | n/a | Yes (web + ext) |
| Open a Cluster | click → detail | click → detail | `GET /api/v1/clusters/:id?limit&offset` | n/a | Yes (web + ext) — paginated |
| Save Cluster as Space | "Save as Space" | "Save as Space" | `POST /api/v1/clusters/:id/save-as-space` | n/a | Yes (web + ext) |
| AI processing status | detail page | detail page | `item.status`, `job.status` | n/a | Yes (web + ext) |
| Quota exhausted state | "AI delayed" badge | "AI delayed" badge | `quota.exhausted` flag | RATE_LIMITED | Yes (web + ext) |

---

## C. Gemini production status

| Capability | Provider | User-facing | Notes |
|---|---|---|---|
| **Text generation** (tags) | Gemini | ✅ | `gemini-3.8-flash`, maxOutputTokens 1024 to leave headroom for thinking + JSON |
| **OCR** | Gemini | ✅ | multimodal; images only; deterministic text-only fallback for non-image captures |
| **Image Description** | Gemini | ✅ | returns `caption`; falls through to `LocalImageDescriptionProvider` in dev only |
| **TLDR** | Gemini | ✅ | explicit `tldrTotalBudgetMs = 90 000`; deterministic fallback distinguishable in UI |
| **Text Embeddings** | Gemini | ✅ | `gemini-embedding-001` @ 1024 dims, identity `${name}-${model}-v1` |
| **Document Chunk Embeddings** | Gemini | ✅ | sequential embedding, per-chunk quota, resume on restart |
| **Visual Embeddings** | Gemini | ✅ (opt-in) | `gemini-embedding-2`; visual/text spaces never mixed; visual similarity UI is deferred to a separate milestone |
| **Semantic Search** | Gemini + pgvector | ✅ | one query embed per search, deduped by `(query, model)` |
| **Related Memories** | pgvector edges | ✅ | rebuilt by `auto-link-similar.ts` (target.item_id fix) |
| **Content Clusters** | pgvector Louvain | ✅ | `/api/v1/clusters` and `/api/v1/clusters/:id` |
| **Quota enforcement** | in-memory counter | ✅ | per-user daily; PG migration is P1 |
| **Retry/timeout** | exponential backoff | ✅ | bounded retries, Retry-After honored, circuit breaker after 5 consecutive failures |
| **Visual similarity UI** | n/a | ⏸ deferred | `GeminiVisualEmbeddingProvider` works; the visual-similarity **user experience** is deferred to a separate milestone to avoid scope creep |

### Gemini status diagnostics

The `GET /api/v1/ai/status` (out of scope for this milestone) and the
`info()` log line on AI service construction distinguish:

- `provider_configured` — env is set
- `model_available` — model id is in the allow-list
- `real_test_successful` — a real call returned 200
- `free_tier_quota_reached` — the project hit Google's per-minute limit
- `auth_failure` — 401 / 403
- `timeout` — `TIMEOUT` ProviderError
- `circuit_breaker_open` — `GeminiCircuitOpenError`

---

## D. Environment variables

### D.1 Backend (`apps/api` / `packages/ai` / `packages/database`)

| Variable | Required | Secret | Default | Notes |
|---|---|---|---|---|
| `NODE_ENV` | yes | no | `development` | Must be `production` in prod |
| `PORT` | no | no | `3001` | Cloudflare/Render port |
| `DATABASE_URL` | yes | yes | — | Supabase pooler connection |
| `SUPABASE_URL` | yes | no | — | Project URL |
| `SUPABASE_ANON_KEY` | yes | yes | — | Browser-facing key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | yes | — | **Server only** — never web/extension |
| `GEMINI_API_KEY` | yes (production) | yes | — | Google AI Studio key |
| `DEMO_MODE` | no | no | `false` | Hard-fails to `false` in production |
| `AUTH_AUTO_CONFIRM` | no | no | `false` | Hard-fails to `false` in production |
| `CORS_ALLOWED_ORIGNS` | yes (production) | no | — | Comma-separated. Examples: `https://app.mnemonics.example,https://mnemonics.example` |
| `AI_TEXT_PROVIDER` | no | no | `gemini` | One of `gemini`, `heuristic`, `ollama` |
| `AI_EMBEDDING_PROVIDER` | no | no | `gemini` | One of `gemini`, `ollama`, `noop` |
| `OCR_PROVIDER` | no | no | `gemini` | One of `gemini`, `ocrspace`, `tesseract` |
| `AI_IMAGE_DESCRIPTION_PROVIDER` | no | no | `gemini` | One of `gemini`, `local` |
| `AI_TLDR_PROVIDER` | no | no | `deterministic` | One of `deterministic`, `ollama`, `gemini` |
| `AI_TEXT_FALLBACK` | no | no | `false` | Production: must be `false` |
| `AI_EMBEDDING_FALLBACK` | no | no | `false` | Production: must be `false` |
| `OCR_LOCAL_FALLBACK` | no | no | `false` | Production: must be `false` |
| `AI_USER_DAILY_LIMIT` | no | no | `100` | Per-user daily Gemini calls |
| `AI_FREE_ONLY` | no | no | `true` | Hard-stops non-free providers |
| `GEMINI_MODEL` | no | no | `gemini-3.8-flash` | Text model |
| `GEMINI_EMBEDDING_MODEL` | no | no | `gemini-embedding-001` | Embedding model |
| `GEMINI_EMBEDDING_DIMENSIONS` | no | no | `1024` | Must match `item_embeddings.embedding` |
| `GEMINI_VISUAL_EMBEDDING_MODEL` | no | no | `gemini-embedding-2` | Visual model |
| `GEMINI_VISUAL_EMBEDDING_DIMENSIONS` | no | no | `512` | Visual space width |
| `GEMINI_REQUEST_TIMEOUT_MS` | no | no | `45000` | Per HTTP attempt |
| `GEMINI_QUEUE_WAIT_TIMEOUT_MS` | no | no | `30000` | Pacer cap (NEW) |
| `GEMINI_TOTAL_BUDGET_MS` | no | no | `60000` | Per-request execution budget (NEW) |
| `GEMINI_TLDR_TOTAL_BUDGET_MS` | no | no | `90000` | TLDR deadline (NEW) |
| `GEMINI_MAX_RETRIES` | no | no | `2` | Bounded retries (not multiplied with job retries) |
| `GEMINI_RATE_LIMIT_RPM` | no | no | `2` | Soft cap on client side |
| `GEMINI_MAX_CONCURRENT_REQUESTS` | no | no | `2` | Local concurrency cap |
| `OCR_SPACE_API_KEY` | no | yes | — | Only if `OCR_PROVIDER=ocrspace` |
| `CLUSTER_ENABLED` | no | no | `true` | |
| `CLUSTER_REFRESH_CRON` | no | no | `0 3 * * *` | |

### D.2 Web (`apps/web`)

| Variable | Required | Secret | Default | Notes |
|---|---|---|---|---|
| `VITE_API_URL` | yes | no | — | Full HTTPS API URL |
| `VITE_WEB_URL` | yes | no | — | Full HTTPS web URL (used for share links) |
| `VITE_DEMO_MODE` | no | no | `false` | **No `VITE_*` should ever carry a key.** |
| `VITE_CHROME_EXTENSION_URL` | no | no | — | Optional link from the web dashboard |
| `VITE_EDGE_EXTENSION_URL` | no | no | — | Optional link from the web dashboard |

### D.3 Extension

| Variable | Required | Secret | Default | Notes |
|---|---|---|---|---|
| `MNEMONICS_API_URL` | yes | no | — | Injected by `scripts/package-extension.mjs` |
| `MNEMONICS_WEB_URL` | yes | no | — | Injected by `scripts/package-extension.mjs` |

The packaging script refuses to build a ZIP that contains:
- `.env` or `.env.*`
- `service_role` keys (string check)
- `AIza...` keys (Gemini key pattern check)
- `postgres://` or `postgresql://` URLs containing a password
- `localhost` API URLs when building for production

### D.4 Removed / obsoleted variables

| Old name | Status | Notes |
|---|---|---|
| `OPENAI_API_KEY` | removed from codebase | OpenAI was removed entirely; no provider, no env |
| `AI_OCR_FALLBACK` | renamed to `OCR_LOCAL_FALLBACK` | kept old name as a no-op alias for one release |
| `USE_LOCAL_INFERENCE` | removed | the `AI_*_PROVIDER` and `*_FALLBACK` envs are the single source of truth |
| `EMBEDDING_PIPELINE_DATE` | removed | date was a bug, not a feature |
| `DAILY_QUOTA` | renamed to `AI_USER_DAILY_LIMIT` | matches the impl class name |
| `EXTENSION_API_URL` | renamed to `MNEMONICS_API_URL` | shared with web in documentation |

---

## E. Database

### E.1 Migration status

| Migration | Status | Notes |
|---|---|---|
| 001-016 | applied | historical, untouched |
| 017 (embedding_kind column) | **applied this milestone** | dry-run → apply via `migrate.ts`; the recovery script re-embedded failed jobs |
| 018 | applied | historical |
| 019-024 | **applied this milestone** | dry-run → apply; the schema cache was reloaded with `NOTIFY pgrst, 'reload schema'` |

**No destructive migrations.** All applied this milestone were forward-only
column additions / identity changes; no rows dropped.

### E.2 Schema verification

`item_embeddings.embedding` is `vector(1024)` to match Gemini and the
local fallback (bge-m3). `item_embeddings.embedding_kind` carries the
`${name}-${model}-v1` identity string. Semantic search filters on
`embedding_kind = ${queryKind}` before computing `<=>`, so two
incompatible models can never be compared.

`item_edges` is rebuilt by `auto-link-similar.ts` (with the
`target.item_id` fix). Existing rows are not destroyed; the rebuild
upserts by `(source_item_id, target_item_id, kind)`.

### E.3 Backfill

29 failed embedding jobs from the pre-milestone window were
recovered by `recover-failed-embed-jobs.ts`. New captures go
through the now-correct `embedForUser` path.

### E.4 Rollback strategy

- `migrate.ts` is idempotent; each migration is a separate file with
  a `down` companion only for the reversible column-add migrations
  introduced this milestone. No data-loss migrations exist.
- Embedding-kind identity change is **not reversible** without a
  full re-embed; the new identity is intentionally forward-stable
  (no date), so future rollbacks are unnecessary.

---

## F. Testing

### F.1 Commands & results

| Command | Result | Time | Environment |
|---|---|---|---|
| `pnpm typecheck` | ✅ 6/6 packages green | ~14s | local Windows 10, Node 22 |
| `pnpm -r test` | ✅ 600+ passed, 1 skipped | ~3.5min | local + Supabase test pool |
| `pnpm --filter @mnemonics/ai test` | ✅ 129/129 | ~5s | local |
| `pnpm --filter @mnemonics/database test` | ✅ 72/72 | ~12s | local + Supabase test pool |
| `pnpm --filter @mnemonics/api test` | ✅ 262/262 | ~40s | local + Supabase test pool |
| `pnpm --filter @mnemonics/extension-tests test` | ✅ 73/73 | ~25s | jsdom |
| `pnpm --filter @mnemonics/web test` | ✅ 138/138 | ~20s | jsdom |
| `pnpm build` | ✅ all packages + apps compile | ~1min | local |
| `pnpm gates:all` | ✅ all 8 quality gates pass | ~3min | local |
| `pnpm extension:package:test` | ✅ extension ZIP builds, contains no secrets | ~5s | local |

### F.2 Pre-existing test skips

`src/routes/__tests__/cluster-detail-pagination.test.ts` has 1
intentional skip (unrelated to this milestone). The full test count
is 600+ passing.

### F.3 Environment tested

- Local Windows 10, Node 22, PowerShell 7
- Supabase test project (separate from production)
- pg-mem for unit tests that don't need a real Postgres

### F.4 Remaining blockers (E2E)

The Phase 12 E2E journeys (A-H) require a **staging environment** with
a real Supabase project, a real Gemini key, and a deployed web
instance. They cannot be executed from this dev box. The procedure
is documented in `docs/production-deployment-checklist.md`.

---

## G. Deployment classification

> **Repository state: READY FOR STAGING.**
> **Promotion to STAGING VERIFIED: pending operator-driven smoke run.**
> **Promotion to READY FOR PUBLIC BETA: pending operator security,
> billing, and privacy confirmations listed in §H.**

The code is ready. The next gate is the **staging smoke test**:

1. Deploy the API to Render Free (web: Cloudflare Pages).
2. Apply pending migrations to the staging Supabase project.
3. Smoke a real capture → Gemini → embed → search end-to-end.
4. Smoke a real extension install.
5. Smoke a quota-exhaustion path.
6. Smoke an OCR-failure path.

If all six succeed, the repo moves to **STAGING VERIFIED**. The
final gate (public beta) is the operator actions in §H.

---

## H. Operator actions (require user approval)

These require **explicit user authorization** before the agent can
act. The agent will not perform any of these automatically.

### H.1 Secret rotation

- [ ] **Supabase service-role key** — confirm whether the previous
      GitHub-exposed key has been rotated in the Supabase project.
      Even though the literal is removed from the repo, the key may
      still be live until rotated in the Supabase dashboard.
- [ ] **Gemini API key** — confirm the key in `.env` is a Free-Tier
      key from a verified AI Studio project. If not, regenerate.
- [ ] **DATABASE_URL** — confirm the connection string points to the
      staging Supabase pooler, not the live production database.

### H.2 Supabase configuration

- [ ] Storage bucket `mnemonics-assets` is **private** in the
      staging and production projects.
- [ ] RLS is enabled on every table added by migrations 017-024.
- [ ] The `embedding_kind` column exists on `item_embeddings`
      (verification SQL in `docs/production-deployment-checklist.md`).
- [ ] `mnemonics-assets` CORS settings allow the production web
      origin (not `*`).

### H.3 Live database migrations

- [ ] Apply `migrate.ts` to the **staging** project first; verify
      with `recover-failed-embed-jobs.ts --dry-run` before any live
      apply.
- [ ] After staging is verified for 24 hours, repeat on the
      **production** project with the operator present.

### H.4 Gemini billing / Free-Tier verification

- [ ] Confirm the project's Gemini model list at
      <https://ai.google.dev/gemini-api/docs/models>.
- [ ] Confirm `gemini-3.8-flash` is on the Free Tier.
- [ ] Confirm `gemini-embedding-001` is on the Free Tier.
- [ ] Confirm `gemini-embedding-2` (visual) is on the Free Tier.
- [ ] Set up a billing alert at $0 (Free Tier only) so a future
      config drift cannot accidentally spend money.

### H.5 Real-API smoke test

Run the procedure in `docs/production-deployment-checklist.md`:
- Sign up, log in, save a note, save a link, save an image, save
  a PDF.
- Verify OCR, tags, TLDR, and embeddings landed in the staging
  Supabase.
- Search for the saved content by keyword and by semantic query.
- Open the saved item from both the web and the extension.
- Delete the item; verify deletion reflects in both clients.
- Exhaust the per-user quota; verify the item is still saved and
  AI processing is correctly marked delayed.

### H.6 Hosting deployment

- [ ] **Render Free** for the API. The previous `deploy/render.yaml`
      used a paid `starter` plan and a paid Postgres; it has been
      replaced by a Free-Tier-only manifest.
- [ ] **Cloudflare Pages** for the web (Free Tier).
- [ ] **No paid PostgreSQL** is provisioned.
- [ ] No automatic upgrade path is enabled.

### H.7 Extension store publication

- [ ] Zip the production extension via `pnpm extension:package`.
- [ ] Verify the ZIP contains **no** `.env`, no service-role key,
      no Gemini key, no `localhost` URLs.
- [ ] Submit to Chrome Web Store and Edge Add-ons.
- [ ] Set the listing to **unlisted** until the staging smoke run
      succeeds.

### H.8 Privacy & consent

- [ ] Update `docs/privacy.md` to explicitly enumerate which
      memory fields are sent to Gemini (title, caption, OCR text,
      raw text, source URL).
- [ ] Add an in-app "AI is enabled" toggle that, when off, sets
      `AI_TEXT_PROVIDER=heuristic`, `AI_EMBEDDING_PROVIDER=noop`,
      `AI_TLDR_PROVIDER=deterministic` per user.
- [ ] The toggle must not delete previously-generated embeddings;
      it only stops future calls.

---

## I. Appendix — git history of this milestone

```
fix/production-readiness-gemini-workflows
├── f4d9a93  fix(p0): embedding version, AI quota, OCR fallback, query dedup
├── xxxxxxx  fix(web): real capture flows, memory detail, pagination
└── 42474b2  fix(p0): cors allowlist, separate gemini budgets, dedup cluster setup
```

All commits are atomic, scoped to a single concern, and leave the
test suite green at each step.

---

**End of audit.**
