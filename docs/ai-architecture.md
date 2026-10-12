# AI architecture

This document is the single place that describes how Mnemonics talks
to AI providers, who is allowed to call which, and what the failure
modes look like. The authoritative code lives in
[`packages/ai`](../packages/ai/). This file is the high-level map.

## Goals

1. **Zero paid cost by default.** A fresh `pnpm install` plus
   `pnpm demo` works end-to-end without any paid API.
2. **Gemini first, local second, OpenAI never.** OpenAI was removed
   from the codebase entirely. There is no `OPENAI_API_KEY` and no
   `openai` provider, so a ChatGPT key can no longer be selected by
   accident. `AI_FREE_ONLY` remains as a guard against a future paid
   provider being enabled silently.
3. **Capture is always preserved.** Every enrichment step (OCR,
   tags, embeddings, visual) is best-effort. A failure marks the
   item as "enrichment degraded" but the saved item is still
   visible and lexically searchable.
4. **One interface per concern.** Handlers depend on `TextProvider`,
   `EmbeddingProvider`, `OcrProvider`, `VisualProvider`. Swapping
   the concrete implementation is a one-line change in
   `ai-service.ts`.
5. **No silent mock in production.** The `NoopEmbeddingProvider`
   refuses to produce fake vectors. Missing keys result in `noop`
   providers that throw a clear `ProviderError` so the handler can
   mark the item as "embedding pending" rather than persist a
   meaningless vector.

## Provider interfaces

```
TextProvider          generateTags(content, opts) → string[]
                      summarize(content, opts)    → string
                      info()                      → { name, model }

EmbeddingProvider     embedOne(text, opts)        → number[]
                      embedMany(texts, opts)      → number[][]
                      info()                      → { name, model, dimensions }

OcrProvider           recognize(input, opts)      → { text, engine, confidence, language, errorCode }
                      info()                      → { name, model }

VisualProvider        embed(input)                → { vector, model, inferenceMs }
                      warmup()                    → void  (idempotent, model load)
                      info()                      → { name, model, dimensions, loaded }
```

Every method can throw `ProviderError` with a stable failure code:

```
RATE_LIMITED          429 / quota — retryable, respect Retry-After
PROVIDER_UNAVAILABLE  5xx / network — retryable
INVALID_API_KEY       401 / 403 / 400 with auth message — NOT retryable
INVALID_RESPONSE      malformed body — NOT retryable
INPUT_TOO_LARGE       413 / explicit error — NOT retryable
TIMEOUT               AbortError — retryable
UNKNOWN               catch-all
```

## Provider implementations

| Interface          | `gemini` (primary)   | `ollama` (local fallback) | `heuristic`    | `noop`     | `ocrspace`             | `tesseract`        | `local` (CLIP) |
|--------------------|----------------------|---------------------------|----------------|------------|------------------------|--------------------|-----------------|
| TextProvider       | GeminiTextProvider   | OllamaTextProvider    | HeuristicTextProvider | —   | —                      | —                  | —               |
| EmbeddingProvider  | GeminiEmbeddingProvider (1024-d) | OllamaEmbeddingProvider (1024-d, `bge-m3`) | — | NoopEmbeddingProvider | —      | —                  | —               |
| OcrProvider        | —                     | —                        | —              | —          | OcrSpaceProvider       | TesseractOcrProvider | —              |
| VisualProvider     | —                     | —                        | —              | —          | —                      | —                  | ClipLocalProvider |

Both embedding providers emit **exactly 1024 floats** because they
share the `item_embeddings.embedding` column (`vector(1024)`, migration
017). A local model of a different width is rejected rather than
padded — see `providers/embeddings/ollama.ts` for why padding is worse
than degrading.

The `noop` provider is **not** a mock. It throws `ProviderError` with
`code=PROVIDER_UNAVAILABLE` on every call. This is intentional: the
previous architecture silently generated sin-based fake vectors,
which produced semantically meaningless results. The `noop` provider
forces the handler to either configure a real key or accept a
degraded state.

## Fallback hierarchy

```
OCR:  primary (ocrspace) →  fallback (tesseract) →  save with ocr_text=NULL
        ↓                        ↓
      empty text              throws
        ↓                        ↓
      try fallback            raise; mark enrichment as failed
```

The `recognizeWithFallback` helper in
`packages/ai/src/providers/ocr/index.ts` owns this chain. It does
NOT swallow `INVALID_API_KEY` — those propagate up so the operator
notices a misconfiguration.

## Retry policy

Implemented per-provider in each `callXxx` helper:

```
attempt 1 → 500 ms wait
attempt 2 → 1500 ms wait
attempt 3 → 4000 ms wait
give up   → throw ProviderError (retryable)
```

`Retry-After` from a 429 response overrides the wait. The jitter
(± 20 %) prevents thundering-herd retries from N workers.

## Cache layer

`packages/ai/src/cache.ts` ships a small `MemoryCache<K, V>` with
TTL + LRU eviction. The DI service exposes four caches:

```
tagCache        sha256(provider + model + content) → string[]
summaryCache    sha256(provider + model + content) → string
embeddingCache  sha256(provider + model + content) → number[]
ocrCache        sha256(provider + bytes + mimeType) → OcrResult
```

The cache key is built from provider-relevant inputs only — not
from user id — so an item that is captured twice with the same text
will not be re-sent to Gemini. This is especially important for
embeddings, which dominate the per-item API cost.

Cache is in-memory per process. Multi-instance deployments can
back it with Redis later by swapping the `CacheStore`
implementation; the interfaces are stable.

## AI_FREE_ONLY enforcement

The check is in `ai-config.ts`:

```ts
if (freeOnly) {
  if (visionProvider !== "local") throw new Error("...");
}
```

Note what is *no longer* here: the old `embeddingProvider === "openai"`
check. OpenAI is not a provider at all, so the guard for it is gone
rather than merely enforced.

This is the single place that knows about the rule. Every other
component can trust the resulting `AiConfig` to be free-only when
the flag is on.

## Data flow (per item)

```
capture (POST /api/v1/capture)
  ↓
save item with status=pending
  ↓
enqueue ocr / tag / embed / visual jobs in parallel
  ↓                       ↓                     ↓
  ocr job                tag job             embed job
  ↓                       ↓                     ↓
provider.recognize    provider.generateTags   provider.embedOne
  ↓                       ↓                     ↓
update ocr_text       update tags            save embedding vector
update ocr_engine     update searchable_text update item_embeddings
  ↓                       ↓                     ↓
       enqueue visual embed (image types only)
              ↓
       provider.embed(image)
              ↓
       save item_visual_embeddings
              ↓
mark item status=ready when all enrichments are completed
or have failed terminally
```

Failure of any single enrichment step does NOT block the others.
The item becomes `ready` as soon as the LAST enrichment either
completes or terminally fails. The `enrichment_status` columns on
`items` (added in migrations 012+) carry the per-step state so the
UI can show "Reading text from image..." while OCR is still in
flight.

## Testing

| Layer        | Test file                                       |
|--------------|-------------------------------------------------|
| Config       | `packages/ai/src/__tests__/ai-config.test.ts`   |
| Cache        | `packages/ai/src/__tests__/cache.test.ts`       |
| Types        | `packages/ai/src/__tests__/types.test.ts`       |
| Heuristic    | `packages/ai/src/__tests__/providers/text-heuristic.test.ts` |
| Gemini text  | `packages/ai/src/__tests__/providers/text-gemini.test.ts` |
| Gemini embed | `packages/ai/src/__tests__/providers/embeddings-gemini.test.ts` |
| Local embed / noop | `packages/ai/src/__tests__/providers/embeddings-local-noop.test.ts` |
| OCR.Space    | `packages/ai/src/__tests__/providers/ocr-ocrspace.test.ts` |
| CLIP stub    | `packages/ai/src/__tests__/providers/vision-clip.test.ts` |
| Service      | `packages/ai/src/__tests__/ai-service.test.ts`  |

All network calls are mocked. The OCR.Space tests use a real
`fetch` mock that returns canned `ParsedResults`. Tesseract is
tested by asserting the not-installed error path (M7 will add
real-fixture integration tests when the WASM binary is wired).

## Production target: Gemini-only cloud AI

The production target is a lightweight cloud API server with **no
Ollama, Tesseract, Transformers.js, or local CLIP**. The
authoritative model selection is:

| Capability         | Provider config      | Model                       | Output           |
|--------------------|----------------------|------------------------------|------------------|
| Tag generation     | `AI_TEXT_PROVIDER=gemini` | `GEMINI_MODEL` (`gemini-3.8-flash`) | ≤ 5 kebab-case tags |
| TLDR               | `AI_TLDR_PROVIDER=gemini`  | `GEMINI_MODEL`         | ≤ TLDR_MAX_LENGTH chars |
| Image description  | `AI_IMAGE_DESCRIPTION_PROVIDER=gemini` | `GEMINI_MODEL` | ≤ 200 chars caption |
| OCR                | `OCR_PROVIDER=gemini`       | `GEMINI_MODEL`         | visible text, line breaks preserved |
| Text embeddings    | `AI_EMBEDDING_PROVIDER=gemini` | `gemini-embedding-001` | 1024-d float32 |
| Document chunk embeddings | same as text | `gemini-embedding-001` | 1024-d float32 |
| Visual embeddings  | `VISUAL_EMBEDDING_PROVIDER=gemini` | `GEMINI_VISUAL_EMBEDDING_MODEL` (`gemini-embedding-2`) | 512-d (separate storage) |

All Gemini HTTP traffic flows through a single shared client —
[`packages/ai/src/gemini-client.ts`](../packages/ai/src/gemini-client.ts).
Centralising the request/response lifecycle gives us one place to
enforce:

- bounded per-attempt timeout (`GEMINI_REQUEST_TIMEOUT_MS`, default 45 s)
- exponential backoff with jitter, capped at `GEMINI_MAX_RETRIES`
- respect for `Retry-After` on 429
- retryable vs. non-retryable classification of HTTP and network errors
- per-process concurrency cap (`GEMINI_MAX_CONCURRENT_REQUESTS`)
- per-process RPM pacer (`GEMINI_RATE_LIMIT_RPM`)
- circuit breaker: after N consecutive failures, short-circuit for a
  cooldown window so we do not hammer a dead provider
- sanitised telemetry: provider/model/task/latency/retry count are
  recorded; the API key, prompt, and image bytes are never logged

The visual embedding space is **kept distinct** from the text
embedding space: a different model id, a different dimension count,
and a separate `item_visual_embeddings` table. The two similarity
graphs are never compared.

## Free-Tier protection

`AI_FREE_ONLY=true` is the production default. The config validator
in [`packages/ai/src/ai-config.ts`](../packages/ai/src/ai-config.ts):

- refuses any visual provider other than `local` or `gemini`
- refuses `gemini` for visual embeddings when the configured
  `GEMINI_VISUAL_EMBEDDING_MODEL` is not on the verified-Free-Tier
  list (see `FREE_TIER_VISUAL_MODELS` in `ai-config.ts`)

`AI_USER_DAILY_LIMIT` (default 100) caps the per-user daily number
of provider-acknowledged AI calls. The cap is enforced by
[`UserAiQuota`](../packages/ai/src/user-quota.ts) BEFORE any HTTP
call. The counter is reset at UTC midnight. When a user is over
the cap the system throws a non-retryable `RATE_LIMITED` error and
the memory is preserved with whatever enrichment already
completed — the item becomes `ready` and the failure is recorded
for the operator.

Note that `AI_FREE_ONLY=true` is a **hard refusal of non-Free-Tier
providers**, not a guarantee of zero billing. Verify the actual
Google Cloud project billing tier and the model availability on
the Free Tier via the Google AI Studio model catalog before going
live. See `docs/privacy.md` for the user-facing disclosure that
MUST be rendered before any content is sent to Google.
