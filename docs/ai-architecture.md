# AI architecture

This document is the single place that describes how Mnemonics talks
to AI providers, who is allowed to call which, and what the failure
modes look like. The authoritative code lives in
[`packages/ai`](../packages/ai/). This file is the high-level map.

## Goals

1. **Zero paid cost by default.** A fresh `pnpm install` plus
   `pnpm demo` works end-to-end without any paid API.
2. **AI_FREE_ONLY is a hard contract.** `OPENAI_API_KEY` is allowed
   to be set; it just will not be used. The provider factory throws
   at boot if the configuration tries to call a paid provider under
   free mode.
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

| Interface          | `gemini`                       | `heuristic`        | `openai` (legacy) | `noop`     | `ocrspace`             | `tesseract`        | `local` (CLIP) |
|--------------------|--------------------------------|--------------------|--------------------|------------|------------------------|--------------------|-----------------|
| TextProvider       | GeminiTextProvider             | HeuristicTextProvider | —                 | —          | —                      | —                  | —               |
| EmbeddingProvider  | GeminiEmbeddingProvider        | —                  | OpenAIEmbeddingProvider | NoopEmbeddingProvider | —              | —                  | —               |
| OcrProvider        | —                              | —                  | —                 | —          | OcrSpaceProvider       | TesseractOcrProvider | —              |
| VisualProvider     | —                              | —                  | —                 | —          | —                      | —                  | ClipLocalProvider |

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
  if (embeddingProvider === "openai") throw new Error("...");
  if (visionProvider !== "local")     throw new Error("...");
}
```

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
| OpenAI / noop| `packages/ai/src/__tests__/providers/embeddings-openai-noop.test.ts` |
| OCR.Space    | `packages/ai/src/__tests__/providers/ocr-ocrspace.test.ts` |
| CLIP stub    | `packages/ai/src/__tests__/providers/vision-clip.test.ts` |
| Service      | `packages/ai/src/__tests__/ai-service.test.ts`  |

All network calls are mocked. The OCR.Space tests use a real
`fetch` mock that returns canned `ParsedResults`. Tesseract is
tested by asserting the not-installed error path (M7 will add
real-fixture integration tests when the WASM binary is wired).
