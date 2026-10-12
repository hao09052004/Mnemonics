# PHASE 1 — Repository Audit Matrix
Branch: `fix/production-readiness-gemini-workflows`
Date: 2026-10-10

## Core User Workflow Matrix

| User Action | Web | Extension | Backend | Gemini | Tests | Status | Priority |
|---|---|---|---|---|---|---|---|
| Register/Login/Logout | ✅ | ✅ | ✅ | N/A | ✅ | Working | — |
| Save Quick Note | ❌ dead UI | ✅ via background | ✅ | ✅ | partial | P0 | |
| Save Link | ❌ dead UI | ✅ via background | ✅ | ✅ | partial | P0 | |
| Upload Image | ⚠️ partial | ✅ via background | ✅ | ✅ | ✅ | P1 | |
| Upload PDF | ✅ | ✅ | ✅ | ✅ | partial | P1 | |
| Open memory detail | ❌ no route | ✅ | ✅ | N/A | ✅ | P0 | |
| Everything pagination | ❌ 50 items only | ✅ | ✅ | N/A | ❌ | P0 | |
| Semantic search | ✅ | ✅ | ✅ | ✅ | ✅ | Working | — |
| Smart Spaces | ✅ | ⚠️ partial | ✅ | ✅ | partial | P1 | |
| Manual Spaces | ✅ | ❌ dead handler | ✅ | N/A | partial | P1 | |
| Content Clusters | ✅ | ⚠️ single page | ✅ | ✅ | partial | P1 | |
| Favorites | N/A (removed) | N/A (removed) | ✅ | N/A | ✅ | Done | — |
| AI Quota enforcement | ✅ | ✅ | ❌ NOT wired | N/A | ❌ | P0 | |
| Rediscover | ⚠️ stub page | ❌ | N/A | N/A | ❌ | P2 | |
| Reminders | ⚠️ stub page | ❌ | N/A | N/A | ❌ | P2 | |

## P0 Issues (blocks public launch)

| # | Issue | Root Cause | File | User Impact | Fix |
|---|---|---|---|---|---|
| P0-1 | `currentEmbeddingVersion()` uses current date | Function returns `${name}-${model}-${date}` | `apps/api/src/jobs/handlers/embed.ts:444` | Memories embedded on different days are NEVER related via auto-link. Same model, same user, same text, different date → no edge | Stable version: `${name}-${model}-pipeline-v1` |
| P0-2 | UserAiQuota is NOT enforced | `record()` never called by any handler | `packages/ai/src/user-quota.ts`, `apps/api/src/jobs/handlers/*.ts` | One user can burn the shared Gemini Free Tier quota for everyone | Wire `getDefaultUserAiQuota().record(userId, task)` in tag/embed/ocr/enrich handlers |
| P0-3 | Tesseract instantiated when `OCR_LOCAL_FALLBACK=false` | `fallbackOcr` always creates Tesseract in `createAiService()` | `packages/ai/src/ai-service.ts:~98` | 30MB WASM binary downloaded in production | Conditionally instantiate only when fallback=true |
| P0-4 | Save Link / Quick Note dead UI | `handleCaptureAction` only navigates, no API call | `apps/web/src/pages/DashboardPage.tsx:~275` | User clicks "Save Link" or "Quick Note" — nothing saves | Implement dialog + API call |
| P0-5 | `onOpen={() => undefined}` | Detail modal callback not wired | `apps/web/src/pages/DashboardPage.tsx:~330` | User cannot open any memory from Web dashboard | Wire to navigate to `/app/items/:id` |
| P0-6 | No `/app/items/:id` route | Route missing from router | `apps/web/src/app/router.tsx` | Detail modal navigation fails | Add route + ItemDetailPage |
| P0-7 | Everything pagination = 50 fixed | `listItems` hardcoded limit | `apps/web/src/pages/DashboardPage.tsx:~70` | User with 200+ memories can't see items beyond first page | Implement scroll/offset pagination |
| P0-8 | Duplicate query embedding in search | `embedOne()` called separately for semantic + chunk legs | `packages/database/src/search-service.ts:~220` | Every search embeds query twice (wastes quota, doubles latency) | Compute once, reuse |
| P0-9 | OCR.Space is undocumented cloud fallback | Explicit but never operator-documented | `packages/ai/src/providers/ocr/` | Silent credit burn if Gemini fails without operator knowledge | Document + make explicit opt-in |

## P1 Issues (reliability/correctness)

| # | Issue | Root Cause | File | Fix |
|---|---|---|---|---|
| P1-1 | No PostgreSQL-backed quota | `UserAiQuota` is in-memory only | `packages/ai/src/user-quota.ts` | Add `user_ai_quotas` table migration for multi-process |
| P1-2 | Unbounded `Promise.all` for chunk embedding | `Promise.all(chunks.map(...))` in `embedDocumentChunks` | `apps/api/src/jobs/handlers/embed.ts:~310` | Bounded concurrency loop |
| P1-3 | Extension Spaces dead handler | `return; /* detail view TBD */` | `apps/extension/dashboard.js` | Implement Space detail navigation |
| P1-4 | Extension Clusters single-page | No pagination in cluster API call | `apps/extension/dashboard.js` | Add offset pagination to cluster API |
| P1-5 | CORS not allowlisted | `app.use(cors())` no origin list | `apps/api/src/app.ts` | Configurable production CORS policy |
| P1-6 | Visual embeddings incomplete | Provider exists but UI/search not wired | `packages/ai/src/providers/vision/` | Disable in production, document as P2 |
| P1-7 | TLDR budget issues | Shared `GEMINI_REQUEST_TIMEOUT_MS` counts RPM wait | `packages/ai/src/gemini-client.ts` | Separate budgets: queue-wait, request-exec, total-deadline |
| P1-8 | AI health status incomplete | Only probes presence, not real health | `packages/ai/src/ai-service.ts:~140` | Distinguish: configured vs available vs quota-ok |

## P2 Issues (polish)

| # | Issue | Fix |
|---|---|---|
| P2-1 | Rediscover/Reminders are stub pages | Hide from nav in production |
| P2-2 | OCR.Space undocumented operator selection | Explicit env var `OCR_SPACE_FALLBACK=false` |
| P2-3 | AI health check doesn't distinguish quota exhaustion | Surface `quota_exhausted` status |

## Already Fixed (from previous sessions)

- ✅ Favorites removed from Web (DashboardTopNav, router, FavoritesPage deleted)
- ✅ Favorites removed from Extension (error state → silent fallback)
- ✅ 14 obsolete `probe-*.mts` scripts deleted
- ✅ Service role key not in extension bundle
- ✅ Auth facade (`/api/v1/auth/*`) implemented with throttling/audit
- ✅ Gemini retry policy (exponential backoff, circuit breaker, non-retryable classification)
- ✅ Deterministic TLDR fallback when Gemini fails
- ✅ Job queue stale-job reaper
- ✅ Document chunk embedding (upsert, delete-missing, idempotent)
- ✅ `embeddings_compatible()` SQL guard in auto-link
- ✅ RRF hybrid search (lexical + semantic)
- ✅ Smart Spaces reuse same search service
