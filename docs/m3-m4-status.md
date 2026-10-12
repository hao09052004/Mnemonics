# Mnemonics — Current Status (after Spaces v2 / PR #9)

> Authoritative source of truth for the current state of the codebase is
> the code itself and the canonical docs below. This file is a living
> snapshot; if anything here disagrees with the linked docs, the linked
> docs win.
>
> Supersedes the earlier "M3 / M4" snapshot that referenced the Suggested
> Spaces / `space_suggestions` feature — that feature was removed in
> migration `018_spaces_v2_smart_rules.sql`. See
> [`docs/spaces.md`](spaces.md) for the current Spaces contract.

## Canonical current documentation

| Topic | File |
|-------|------|
| Spaces contract (manual + smart + observations) | [`docs/spaces.md`](spaces.md) |
| AI provider architecture | [`docs/ai-architecture.md`](ai-architecture.md) |
| Memory Understanding (OCR / TLDR / image description) | [`docs/memory-understanding.md`](memory-understanding.md) |
| Product brief | [`README.md`](../README.md) |
| Architecture spec | [`specs/0001-system-overview.md`](../specs/0001-system-overview.md) |

---

## 1. Spaces (v2) — current

| Area | Status |
|---|---|
| `spaces` / `space_items` (manual membership persisted) | ✅ |
| `spaces.rule` (smart Space, saved `SearchRequest`) | ✅ |
| Dynamic membership — `resolveSmartSpaceIds` re-executes the saved query on every read | ✅ |
| Smart Space + save-search-as-Space (`POST /api/v1/spaces/from-search`) | ✅ |
| Curated `color` palette (`violet`, `blue`, `teal`, `sage`, `amber`, `rose`, `slate`) enforced by SQL `CHECK` | ✅ |
| Manual-only `space_items` invariant enforced by trigger `space_items_require_manual_space` | ✅ |
| `updated_at` maintained by trigger `spaces_touch_updated_at` | ✅ |
| Ownership isolation (route + repository + RLS) | ✅ |
| Web UI: `/app/spaces`, `/app/spaces/:id`, multi-select add, save-search-as-Space | ✅ |
| Tests: `packages/database/src/__tests__/spaces.test.ts`, `apps/api/src/routes/__tests__/spaces.test.ts`, `apps/web/src/components/spaces/__tests__/*`, `apps/web/src/pages/__tests__/spaces-pages.test.tsx`, `apps/api/scripts/e2e-pipeline.mts` (scenarios A + B) | ✅ |

> Migration lineage (Spaces): `014_spaces.sql` (historical, with `space_rules` and `space_suggestions`) → `018_spaces_v2_smart_rules.sql` (current; renames `dynamic` → `smart`, drops `space_rules` and `space_suggestions`, replaces per-row rules with a saved `SearchRequest`, adds the colour column, and installs the membership trigger).

## 2. Suggested Spaces — removed

- `space_suggestions` table — dropped in migration 018.
- `apps/api/src/spaces/suggestions.ts` (AI clustering) — removed.
- `/api/v1/spaces/suggestions`, `/api/v1/spaces/suggestions/refresh`, `DELETE /api/v1/spaces/suggestions/:id` — **not** part of the v2 API.

If you find any active reference to these endpoints in documentation or
tests, it is stale and should be removed.

## 3. Memory Understanding — current

| Area | Status |
|---|---|
| `item_enrichments` (caption, tldr, status, source, prompt_version) | ✅ |
| `LocalImageDescriptionProvider` (Transformers.js, `Xenova/vit-gpt2-image-captioning`) | ✅ |
| `DeterministicTldrProvider` (Vietnamese + English, no model) | ✅ |
| `OllamaTldrProvider` (optional local LLM upgrade, with deterministic fallback) | ✅ |
| Async pipeline: `ocr → tag → embed → enrich` (enrich is the TLDR / image-description pass) | ✅ |
| Embedding text builder uses `Title + TLDR + Description + Content + OCR` | ✅ |
| Lexical search boosts `tldr` ('A') and `caption` ('C') | ✅ |
| Manual-TLDR protection (`tldr_source = 'user'`) | ✅ |
| 1024-d embedding column (`vector(1024)`) shared by Gemini + Ollama `bge-m3` | ✅ |
| ItemDetailModal (two-column, TLDR editor, collapsible OCR / image description) | ✅ |
| Failure UX ("Image description is temporarily unavailable." + Retry) | ✅ |
| Lazy / singleton model loading + concurrency cap | ✅ |

> **Not implemented:** Ollama Vision (no `OllamaImageDescriptionProvider`). The only image-description provider is local Transformers.js (`local`).

## 4. Other current endpoints (Spaces API, verified against `apps/api/src/routes/spaces.ts`)

```
GET    /api/v1/spaces                 ?withCounts=1   live smart counts + previews
POST   /api/v1/spaces                                    manual or smart
POST   /api/v1/spaces/from-search                        smart, rule guaranteed
GET    /api/v1/spaces/:id
PATCH  /api/v1/spaces/:id                                 name / colour / rule
DELETE /api/v1/spaces/:id                                 memories survive
GET    /api/v1/spaces/:id/items                           manual: persisted | smart: computed
POST   /api/v1/spaces/:id/items        { itemIds[] }     manual only, idempotent
DELETE /api/v1/spaces/:id/items/:itemId                  membership only
```

> A Smart Space that is asked for `POST /items` returns `422 SPACE_NOT_MANUAL` (a smart Space decides its own membership).

Web routes:

```
/app/spaces                  → SpacesPage (My Spaces, manual + smart)
/app/spaces/:id              → SpaceDetailPage
/app/memories/:id            → ItemDetailModal (overlay, two-column)
```

## 5. Database migrations (apply in order)

```
014_spaces.sql                       — historical base migration (created spaces,
                                       space_items, space_rules, space_suggestions).
015_item_enrichments.sql             — enrichment foundation (caption, tldr,
                                       summary, per-step status, ownership trigger).
016_allow_enrich_job.sql             — adds the `enrich` job type to the jobs
                                       CHECK constraint.
017_embedding_dimensions_1024.sql    — moves `item_embeddings` from vector(1536)
                                       to vector(1024) so a SINGLE column serves
                                       both Gemini and Ollama `bge-m3`.
018_spaces_v2_smart_rules.sql        — current canonical Spaces migration:
                                         • space_type 'dynamic' → 'smart'
                                         • spaces.rule JSONB (a SearchRequest)
                                         • spaces.color with curated CHECK
                                         • manual-only space_items trigger
                                         • spaces.updated_at trigger
                                         • drops space_rules and space_suggestions
                                         • RLS recreated on spaces / space_items
```

## 6. AI configuration defaults (see `.env.example`)

```
AI_FREE_ONLY=true
AI_ALLOW_PAID_PROVIDERS=false
AI_IMAGE_DESCRIPTION=true
AI_IMAGE_DESCRIPTION_PROVIDER=local
LOCAL_IMAGE_DESCRIPTION_MODEL=Xenova/vit-gpt2-image-captioning
AI_TLDR_ENABLED=true
TLDR_MAX_LENGTH=240
TLDR_MAX_SENTENCES=2
AI_TLDR_MIN_TEXT_LENGTH=160
OCR_PROVIDER=local
OCR_LOCAL_FALLBACK=true
OCR_SPACE_API_KEY=
GEMINI_API_KEY=
LOCAL_AI_MAX_CONCURRENCY=1
IMAGE_AI_MAX_DIMENSION=1024
IMAGE_AI_TIMEOUT_MS=30000
```

The configured embedding dimensions are **1024** (Gemini `outputDimensionality=1024` and Ollama `bge-m3`). The column is `vector(1024)`. Do not mix dimensions — the SQL trigger `enforce_item_embedding_dimensions` rejects a row whose `dimensions` value disagrees with the column width.

## 7. Quality gates (live command set, not historical numbers)

Run from the repository root and let CI be the source of counts:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm gates:all
```

> Per-package test runs are defined in `package.json` (`pnpm test`). The
> number of tests is not a contract — it drifts with each merge. The
> exact counts in this snapshot were frozen at audit time and **must
> not be carried forward** into future status docs without a fresh
> run.

## 8. Stubs / placeholders (current state)

- **Rediscover** (`/app/rediscover`) — route exists, page renders "Coming soon". No backend resurfacing logic; not implemented in this milestone.
- **Reminders** (`/app/reminders`) — route exists, page renders "Coming soon. The API for this page is not in v1." No backend reminder table.
- **Document capture** — chip is rendered (and in the extension, the Capture sheet entry exists) but the backend has no `document` kind yet. It is disabled in the UI with a "Coming soon" tooltip/toast.
- **Ollama Vision** — no `OllamaImageDescriptionProvider`. The only image-description path is `LocalImageDescriptionProvider` (Transformers.js).

## 9. Known limitations

- `LocalImageDescriptionProvider` downloads the model on first use; the first OCR+caption run can take 10–30 s depending on the connection.
- Smart Spaces resolve on every read; with many smart Spaces on `/app/spaces`, the page resolves them sequentially to avoid hammering the pgvector index.

## 10. Next session candidates (NOT yet implemented)

- Server-side preset rules ("favorite in last 30 days") in the smart Space rule editor.
- Bulk-apply suggestions (n/a: suggestions were removed; the next thing in this direction is a deterministic in-app recategorisation helper, not a LLM).
- Time-of-day / "memory of the day" panel driven by `tldr`.
- Per-user visual similarity for image Spaces (requires a real visual embedding space — currently no provider writes `item_visual_embeddings`).