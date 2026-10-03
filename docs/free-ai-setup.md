# Free AI setup

Mnemonics defaults to **zero-paid-AI-cost** mode. The product runs
end-to-end without any paid API, and the code refuses to call a paid
provider while `AI_FREE_ONLY=true` — even if `OPENAI_API_KEY` is set.

This document walks you through the free providers Mnemonics talks
to, how to obtain keys, and what happens when a key is missing.

## Quick start

```bash
cp .env.example .env

# (optional) Gemini free tier — Google AI Studio
# (optional) OCR.Space free tier — ocr.space

pnpm install
pnpm demo              # or `pnpm demo:prepare && pnpm demo:api && pnpm demo:web`
pnpm ai:check          # shows the provider status table
```

`pnpm ai:check` output (no keys set):

```
Gemini text ........ OK (heuristic:deterministic-keyword-v1)
Gemini embeddings .. UNAVAILABLE (noop:none)
OCR.Space .......... OK (tesseract:tesseract.js-default)
Local OCR fallback . OK
CLIP model ......... UNAVAILABLE (clip-local:Xenova/clip-vit-base-patch32)
Mode ............... FREE-ONLY
```

With Gemini + OCR.Space keys set:

```
Gemini text ........ OK (gemini:gemini-2.5-flash)
Gemini embeddings .. OK (gemini:gemini-embedding-001)
OCR.Space .......... OK (ocrspace:engine=2) — 0/450 today
Local OCR fallback . OK
CLIP model ......... UNAVAILABLE (clip-local:Xenova/clip-vit-base-patch32)
Mode ............... FREE-ONLY
```

## Provider map

| Concern        | Default provider (free)            | Optional legacy | Env vars                                |
|----------------|------------------------------------|-----------------|-----------------------------------------|
| Text (tags, summary, classification) | Gemini free tier (`gemini-2.5-flash`) | `heuristic`     | `AI_TEXT_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Text embeddings (1536-d) | Gemini (`gemini-embedding-001`) | OpenAI          | `AI_EMBEDDING_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSIONS` |
| OCR            | OCR.Space free tier                | Tesseract local | `OCR_PROVIDER`, `OCR_SPACE_API_KEY`, `OCR_SPACE_DAILY_SOFT_LIMIT`, `OCR_LOCAL_FALLBACK` |
| Visual similarity (CLIP, 512-d) | Local CLIP (transformers.js) | —               | `VISUAL_EMBEDDING_PROVIDER`, `VISUAL_EMBEDDING_MODEL` |

`OPENAI_API_KEY` is kept as **optional legacy** support only. When
`AI_FREE_ONLY=true`, the OpenAI embedding provider refuses to
construct, and the AI service throws on boot. This is enforced in
`packages/ai/src/ai-config.ts`.

## Step 1 — Gemini (text + embeddings)

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Create an API key.
3. Add to `.env`:
   ```
   GEMINI_API_KEY=AIza...
   GEMINI_MODEL=gemini-2.5-flash
   GEMINI_EMBEDDING_MODEL=gemini-embedding-001
   GEMINI_EMBEDDING_DIMENSIONS=1536
   ```

### Free-tier limits (as of writing)

| Model                      | RPM | TPM  | RPD  |
|----------------------------|-----|------|------|
| `gemini-2.5-flash`         | 15  | 1M   | 1500 |
| `gemini-embedding-001`     | 15  | —    | 1500 |

`packages/ai` retries with exponential backoff (500 / 1500 / 4000 ms
± 20 % jitter) and respects `Retry-After` when the provider sets it.

## Step 2 — OCR.Space

1. Create a free account at [ocr.space](https://ocr.space/ocrapi).
2. Copy the API key from the dashboard.
3. Add to `.env`:
   ```
   OCR_PROVIDER=ocrspace
   OCR_SPACE_API_KEY=helloworld
   OCR_SPACE_DAILY_SOFT_LIMIT=450
   OCR_LOCAL_FALLBACK=true
   ```

### Free-tier limits

OCR.Space's free plan publishes ~25 000 requests per month, with
strict per-IP rate limits. Mnemonics adds a **configurable daily soft
limit** (default `450`) so a single user session cannot exhaust the
monthly quota. When the soft limit is hit, the in-memory counter
raises `RATE_LIMITED` and the OCR job falls back to local Tesseract
(if `OCR_LOCAL_FALLBACK=true`, the default).

The counter is process-local: in a multi-instance deployment you
should swap `InMemoryDailyCounter` for a Redis-backed implementation
(M7 work).

## Step 3 — Run the demo

```bash
pnpm install
pnpm demo
```

`pnpm demo` starts Postgres + pgvector, seeds six memories, starts
the API, waits for `/health`, then starts the web dashboard.

To exercise the AI pipeline from the command line:

```bash
pnpm demo:e2e
```

## Step 4 — Diagnostics

```bash
pnpm ai:check           # cheap: provider info() only
pnpm ai:check:deep      # actually call each provider with a probe payload
```

The diagnostics never print API key values. The OCR line shows the
in-memory daily counter (`x/N today`) so an operator can see the
quota burn-down without logging into OCR.Space.

## Privacy

The `AI Processing` section of the in-app settings panel (M2) will
display:

```
Text enrichment
  Gemini — cloud

OCR
  OCR.Space — cloud
  Local fallback enabled

Visual similarity
  Local CLIP — device/server
```

A per-user `cloud_ai_enabled` toggle (M2) will let a privacy-conscious
user force every enrichment to local-only. When toggled OFF:

- capture still works
- manual tags still work
- lexical search still works
- no content is sent to Gemini
- no content is sent to OCR.Space
- Tesseract local OCR is used
- CLIP local visual embeddings still work

## Free-tier limitations you should know

- Gemini free is rate-limited per minute and per day. Heavy batch
  imports will need throttling (the cache layer helps — see
  `packages/ai/src/cache.ts`).
- OCR.Space's free plan returns 25 000 requests / month. Past the
  soft limit, Mnemonics degrades to Tesseract. Tesseract is slower
  and has lower accuracy on noisy images, but the capture is
  preserved either way.
- CLIP local downloads a ~150 MB model on first use. Cache it on
  disk; subsequent boots are sub-second. CPU-only inference is
  ~1–3 s per image on a modern laptop. GPU is dramatically faster.
