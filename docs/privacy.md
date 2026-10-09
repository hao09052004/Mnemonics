# Privacy disclosure — Gemini cloud AI

> **Summary.** Mnemonics can send user content (text, image bytes,
> document text) to the Google Gemini Developer API when cloud AI
> providers are enabled. The Gemini Free Tier, per Google's AI
> Studio terms, MAY use inputs and outputs to improve the model.
> This document explains what is sent, why, and how a user can
> disable it.

## What is sent to Google

When a Gemini cloud provider is selected, the following inputs
leave the server:

| Capability | Endpoint | Payload | Notes |
|------------|----------|---------|-------|
| Tag generation | `generateContent` | Title + body text (≤ 6 KB) | Truncated server-side |
| TLDR | `generateContent` | Title + caption + OCR + first 6 KB of raw text | Never the full document |
| Image description | `generateContent` | Inline image bytes (≤ 10 MB, JPEG/PNG/WebP) | Base64-encoded in the JSON body |
| OCR | `generateContent` | Inline image bytes + extraction prompt | Same shape as image description |
| Text embeddings | `batchEmbedContents` | Title + caption + OCR + raw text (≤ 6 KB per text) | 1024-d float32 returned |
| Visual embeddings | `embedContent` | Inline image bytes (≤ 10 MB) | 512-d float32 returned |

Raw bytes are sent over HTTPS to
`generativelanguage.googleapis.com`. The server-side processing
region is determined by Google; the operator does not select it.

## Why

Every Gemini call is enrichment — it is what turns a raw capture
into a tag, a TLDR, or a semantic-search vector. The captured
memory itself is stored in the operator's own Supabase database
and is NEVER sent to Google. The Gemini call is a one-shot RPC;
Gemini does not retain a copy of the input on the user's behalf
under the Free Tier — see Google's data-usage terms for the
exact policy.

## What is NOT sent

- API keys, auth tokens, or session cookies.
- Other users' memories. The Gemini request contains only the
  current user's content.
- The full source URL of a captured web page (only the host is
  used in the TLDR prompt).
- The user's name, email, or any other account metadata.

## How users can disable cloud AI

The product is in private beta; the operator has not yet
shipped a per-user toggle. The architecture supports it: each
provider has a `provider: "local" | "gemini"` switch in
[`packages/ai/src/ai-config.ts`](../packages/ai/src/ai-config.ts).
The intended UX is a per-account setting that, when disabled:

1. Forces `AI_TEXT_PROVIDER=heuristic`, `AI_TLDR_PROVIDER=deterministic`,
   `AI_IMAGE_DESCRIPTION_PROVIDER=local`, `OCR_PROVIDER=tesseract`,
   `AI_EMBEDDING_PROVIDER=ollama` (if a local model is available)
   or `=noop` (lexical-only search).
2. Surfaces the provider name on the item-detail page so the
   user can see what was used.
3. Preserves the captured memory regardless.

When a user disables cloud AI, items continue to become
`ready` and remain lexically searchable. Semantic search is the
feature that degrades; capture, save, retrieval, and organisation
are unaffected.

## What happens when AI is disabled

- **Tags** fall back to a deterministic keyword heuristic that
  runs locally with no network call. Tags are still generated,
  they are just less curated.
- **TLDR** falls back to a deterministic composition of the
  existing fields. Output is a short, factual sentence derived
  from the title, caption, OCR, and raw text.
- **Image description** falls back to a local Transformers.js
  model (offline development target) or a "Saved image" stub
  if the local model is not installed.
- **OCR** falls back to Tesseract.js (a 30 MB WASM binary
  downloaded on first use) or OCR.Space (a separate, paid/quota'd
  HTTP API). Screenshots remain searchable lexically.
- **Text embeddings** fall back to a local Ollama bge-m3 model
  (if a local daemon is configured) or `noop` (lexical-only
  search). Search remains functional; semantic neighbours are
  not available in noop mode.
- **Visual embeddings** are simply not computed. The
  "Visually similar" panel is hidden in the UI.

## Google Free-Tier caveats

The Free Tier is per-project and per-account, not per-key. A
public beta can exhaust the daily Free-Tier quota in a single
busy hour. `AI_USER_DAILY_LIMIT` and the per-process RPM pacer
are the protections the operator can put in place on our side;
they do not change Google's quota. The operator MUST monitor
the Google AI Studio quota dashboard during early access and
MUST publish a status page or in-app message if the quota is
exhausted.

The Free Tier's data-usage policy may permit Google to use
inputs to improve the model. If the product intends to keep
captured content fully private, the operator MUST either:

- Use a paid Gemini tier with a data-usage opt-out, or
- Switch off the cloud providers entirely (per-user toggle
  above), or
- Self-host a model (defeats the "lightweight cloud" goal of
  this migration).

The operator's choice MUST be reflected in the user-facing
privacy notice.

## Operator checklist before public launch

- [ ] Verify the configured Gemini models are available on the
      Free Tier for the operator's Google Cloud project, via
      the Google AI Studio model catalog.
- [ ] Render the privacy notice in the web dashboard and the
      extension onboarding flow.
- [ ] Implement the per-user cloud-AI toggle (architecture
      already supports it; the UI is the missing piece).
- [ ] Set `AI_USER_DAILY_LIMIT` to a value that survives a
      single user uploading a 200-page PDF.
- [ ] Subscribe to Google's Free-Tier quota-exhausted alert
      (configured in the Google AI Studio dashboard).
- [ ] Publish a status page or in-app banner for quota
      exhaustion.
