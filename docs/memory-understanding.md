# Memory Understanding

Memory Understanding is Mnemonics' enrichment layer. It runs
asynchronously after a memory is captured and produces three
distinct, persisted fields:

| Concept        | Column                  | Source                              |
|----------------|-------------------------|-------------------------------------|
| OCR Text       | `items.ocr_text`        | OCR.Space / Tesseract               |
| Image Description | `item_enrichments.caption` | Local VLM (Transformers.js)    |
| TLDR           | `item_enrichments.tldr` | Deterministic fusion / Ollama / user |

These three MUST stay independent. The UI shows them in three
separate sections.

## Pipeline

```
SAVE IMAGE
   ↓
STORE ORIGINAL (Supabase Storage)
   ↓
async jobs
   ├── ocr     → items.ocr_text
   ├── tag     → tags
   ├── enrich  → item_enrichments.caption
   │            → item_enrichments.tldr
   └── embed   → item_embeddings (Title + TLDR + Description + OCR + Content)
```

The `enrich` job runs after `ocr`/`tag` and writes both `caption`
and `tldr` in a single pass so a single round-trip to the
inference runtime can serve both. A failure in `enrich` does NOT
flip the item's `status` to `failed` — the core memory is already
saved; only the enrichment row is marked `failed` so the UI can
surface a retry button.

## Local image description

We use the local `@huggingface/transformers` runtime. The
default model is `Xenova/vit-gpt2-image-captioning` (~250MB, MIT)
because it is the smallest viable model that runs in CPU-only
Node. A higher-quality alternative is
`Xenova/Salesforce/blip-image-captioning-base` (~440MB). Set
`LOCAL_IMAGE_DESCRIPTION_MODEL` in `.env` to switch.

A pre-processing step reuses `image-prep.ts` (Sharp, auto-rotate,
resize, re-encode) so the model sees a ≤2000px image regardless
of the original size.

The provider is a singleton. It is loaded lazily on first use
and re-used across requests. The `info().loaded` field tells the
diagnostics UI whether the model is hot.

## TLDR

The default TLDR provider is fully deterministic — it composes
`title + caption + ocr + raw_text` into a 1-2 sentence Vietnamese
string. It works with NO model, NO network, NO API keys.

When `AI_TLDR_PROVIDER=ollama`, an optional local LLM upgrade
calls Ollama's `/api/generate` endpoint for a richer wording.
Failure (HTTP error, model not found, empty response) falls
back to the deterministic provider — the user is never left
without a TLDR.

## Manual TLDR protection

User edits are stored with `tldr_source = 'user'`. The async
enrichment job will NOT overwrite a user-edited TLDR. The only
way to replace it is the explicit "Tạo lại" button in the
memory detail UI.

## Search integration

`items.searchable_text` is now the `setweight(...)` OR of:
- title (A)
- raw_text (B)
- ocr_text (B)
- tldr (A)
- caption (C)

The semantic embedding text is:
```
Title: <title>
TLDR: <tldr>
Description: <caption>
Content: <raw_text>
OCR: <ocr_text>
```

## Zero-cost mode

`AI_FREE_ONLY=true` is enforced at the package boundary. No
`OpenAI` / paid `Gemini` / paid `Clarifai` call is made by
`@mnemonics/ai`. Cloud providers may be configured as optional
enhancements; missing keys or quota errors MUST NOT break
Memory Understanding.