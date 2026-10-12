# Document Capture

Document Capture turns PDF / TXT / Markdown files into first-class
Memories: server-authoritative upload, async text extraction, and the
same search / tag / TLDR / related-memory pipeline the rest of the
library already uses.

This milestone was scoped narrowly on purpose. It is not an attempt to
build a general "any file" ingest service — the format whitelist, the
extractor, and the failure semantics are tuned for the three supported
content kinds.

## At a glance

- **Item kind:** `document` (first-class — not a sub-variant of `text`).
- **Supported MIME types:** `application/pdf`, `text/plain`, `text/markdown`.
- **Filename cap:** `.pdf`, `.txt`, `.md`, `.markdown`.
- **Maximum upload:** 20 MB per file.
- **Maximum extracted text:** 500,000 characters (truncated above).
- **Storage:** private Supabase bucket, `<user_id>/<item_id>/<safe-filename>`.
- **Pipeline:** `extract_document → tag → embed → (enrich, best-effort)`.
- **Search:** lexical + semantic + RRF + Smart Spaces — all four reuse
  the existing search service with `kind: "document"`.
- **Detail view:** reuses the same item-detail API as every other kind.
- **Cost:** zero paid APIs. PDF parsing is `pdf-parse` (Node, MIT).

## Supported formats

| Format  | MIME                       | Extension(s)              | Extraction             |
|----------|----------------------------|---------------------------|------------------------|
| PDF      | `application/pdf`          | `.pdf`                    | `pdf-parse` (local)    |
| Plain    | `text/plain`               | `.txt`                    | UTF-8 decode + sanitize|
| Markdown | `text/markdown`            | `.md`, `.markdown`        | UTF-8 decode + sanitize|

The browser's MIME type is trusted, and so is the file extension: when
Chrome misreports `application/octet-stream` for a PDF, the route
falls back to the extension to derive the real MIME. The upload still
gets rejected with `415 Unsupported Media Type` when neither matches.

## Limits

| Limit                    | Value                  | Why                                                |
|--------------------------|------------------------|----------------------------------------------------|
| `DOCUMENT_UPLOAD_MAX_BYTES` | 20 MB (20 × 971 520) | Generous enough for research papers, small enough to keep `pdf-parse` bounded. |
| Extracted text cap       | 500,000 characters     | Keeps `items.raw_text` from becoming an unbounded textblob. Above the cap, the extractor truncates and logs `[ExtractDocumentHandler] item=... extraction exceeded the limit`. |

The 20 MB constant is the only documented limit. There is no per-format
size override on purpose — keeping the limit in one place avoids the
"two limit values that drifted" failure mode.

## Storage model

The original file lives in object storage. **Bytes never land in the
database.** Only the searchable content runs:

```
db: items.raw_text           (extracted text, possibly truncated)
db: items.page_count         (PDF only; nil for TXT/MD)
db: assets.storage_key        (<user>/<item>/<safe-filename>)
db: assets.mime_type         (application/pdf | text/plain | text/markdown)
db: assets.size_bytes        (original size)
db: assets.original_filename (what the user uploaded)
```

`assets` was already part of the schema for images/screenshots. The
document route reuses it: the row is written inside the same
`BEGIN/COMMIT` that creates the item, so the upload is atomic.

If the database insert fails after the storage upload succeeds, the
route deletes the orphaned object via `imageStorage.remove(storageKey)`
best-effort. The user never sees a "captured" card for an object that
doesn't exist.

## Extraction pipeline

```
capture (POST /api/v1/captures/document)
   │
   ├─ validate file (mime + extension + size)
   ├─ upload to object storage
   ├─ insert items row (status='pending')
   ├─ insert assets row
   ├─ commit transaction
   ├─ enqueue `extract_document` job
   │
extract_document (worker)
   │
   ├─ SELECT storage_key, mime_type FROM assets WHERE item_id = $1
   ├─ download bytes from storage
   ├─ extract text (pdf-parse / utf-8)
   ├─ truncate extracted text to 500_000 chars
   ├─ UPDATE items SET raw_text = $2, page_count = $3
   ├─ UPSERT item_enrichments (extraction_status, extraction_error_code)
   │
   ├─ enqueue `tag` job
   │
tag → embed → (enrich, best-effort)
   │
   ├─ item reaches status='ready'
   ├─ embedding row written → document becomes searchable
   ├─ TLDR (deterministic fallback if Ollama/Gemini unavailable)
   ├─ auto-tags populated
   ├─ related memories computed by the existing similarity graph
```

The HTTP response returns the moment the capture is durably saved —
the user does not wait for extraction. They see
"Saved — processing document…" and the dashboard polls for updates.

If extraction throws or the document has no text layer (e.g. scanned
PDF), the memory remains available: the user can still open the
original, rename it, delete it, and add it to a Space. The
`item_enrichments.extraction_error_code` row records why the search
index is empty so the UI can render **"Text extraction unavailable"**.

## Text-layer PDF vs scanned PDF

Phase 1 supports PDFs with a normal text layer. For image-only /
scanned PDFs:

- The PDF is uploaded successfully and the memory is durable.
- Text extraction returns an empty string.
- The enrichment row stores an `extraction_error_code` and the UI
  shows "Text extraction unavailable" instead of fabricating a TLDR.
- The original PDF is still downloadable from object storage via a
  short-lived signed URL.

OCR-of-scanned-PDF is intentionally out of scope. The current OCR
provider is tuned for character-level screenshot text. Wiring it to a
100-page PDF would generate hundreds of image rows, blow past OCR
quotas, and yield mediocre retrieval quality. Future milestones may
add a bounded OCR fallback, but only if it is verified to actually
work.

## TLDR

The deterministic TLDR provider handles documents. It pulls the
title + the first bounded slice of extracted text, so an Ollama
round-trip is never required for a useful summary.

If `AI_TLDR_PROVIDER=ollama` is configured and Ollama is reachable,
the existing OllamaTldrProvider is used instead — same code path as
for every other memory kind.

The embedding representation also reuses the existing builder:

```
Title: <document title>
TLDR: <deterministic or ollama tldr>
Content: <bounded extracted text>
```

The full multi-megabyte PDF is never embedded.

## Search integration

`SEARCH_KINDS` in `@mnemonics/database` already includes `'document'`:

```ts
export const SEARCH_KINDS = ['link', 'text', 'image', 'screenshot', 'document'] as const;
```

- **Keyword:** `POST /api/v1/search?q=...&kind=document`.
- **Semantic:** the `embed` job writes a vector for the document;
  hybrid RRF then matches it against queries the same way as every
  other kind.
- **Filter-only:** `?kind=document` with no `q` returns every
  document for the user.
- **Smart Spaces:** `rule.filters.kind = ['document']` is the same
  shape Smart Spaces use for every kind. Uploading a matching PDF after
  the Space exists automatically surfaces it on the next read — no
  manual membership writes.

## Manual Spaces

Documents work in manual Spaces exactly like every other kind: add
via `POST /api/v1/spaces/:id/items` with `clientRequestId` for
idempotency, remove via `DELETE /api/v1/spaces/:id/items/:itemId`.

## Related memories

Once a document's embedding is written, the existing similarity graph
picks it up. The `EmbedHandler.markReadyIfComplete` step runs the same
"find nearest neighbors above threshold" query as for every other
kind — there is no separate document edge type.

A research-paper PDF about reinforcement learning will appear as a
related memory of a text note about RL the next time the user opens
either card.

## Original document access

Documents live in private storage. The dashboard and extension never
embed a service-role key.

Access flow:

1. The web card or detail view asks the API for a signed URL.
3. The API runs `imageStorage.createSignedUrl(storageKey, 60 * 60)` —
   one hour TTL — and returns it.
4. The browser navigates to the signed URL or downloads the file.

The signed URL is user-scoped server-side: a user can only ever get
back a signed URL for an asset they own, because the route reads the
session token before issuing the signature.

## Scanned PDF / OCR

Out of scope for this milestone. Document the limitation:

- The original PDF is stored.
- Memory is durable.
- Text extraction returns empty.
- UI shows "Text extraction unavailable".
- Future milestones may add a bounded OCR fallback.

## Security boundary

Document extraction is text extraction only. We never execute macros,
embedded JavaScript, external references, or shell commands. The
uploaded file is treated as opaque binary input except for safe text
extraction.

Other guards:

- **Filename sanitisation:** control characters, path traversal (`..`),
  and leading dots are stripped before the file is uploaded. The route
  rejects path-traversal-shaped filenames before they reach storage.
- **MIME + extension validation:** both must agree, or the route 415s.
- **Size limit:** enforced by multer (`limits.fileSize`) and re-checked
  in the route so a bypass cannot yield an oversized asset.
- **Ownership isolation:** storage keys are namespaced
  `<user>/<item>/...`; signed URLs are issued per-request against the
  caller's session.
- **No client-side byte persistence:** the web dashboard never stores
  file bytes in localStorage. The extension never writes document bytes
  to `chrome.storage.local` — only the session tokens live there.

## Tests

| Document        | Cover                                                              |
|-----------------|--------------------------------------------------------------------|
| `packages/shared` | Zod `documentMimeTypes`, `documentReferenceSchema`, capture union. |
| `packages/database` | `tests/...` widening `SEARCH_KINDS` and the `items_type_check`.   |
| `apps/api`      | capture route contract, storage adapter, extraction handlers.     |
| `apps/api` E2E  | PDF / TXT / MD happy paths, oversized 413, unknown MIME 415.        |
| `apps/api` jobs | `extract_document` → `tag` → `embed` end-to-end with a real PDF.  |
| `apps/web`      | `DocumentCaptureDialog.test.tsx` + `memory-kind.test.ts`.          |
| `apps/extension`| `tests/document-upload.test.ts`.                                    |

## Failure modes

| Symptom                                               | Behaviour                                                                |
|-------------------------------------------------------|--------------------------------------------------------------------------|
| Storage upload fails                                  | `503` returned, no item row created.                                     |
| Database insert fails after storage upload            | Orphan object is deleted best-effort; `5xx` returned.                    |
| `extract_document` job enqueue fails after item saved | Capture is still durable; warning surfaced in logs; recovery is via retry.|
| Extraction throws or returns empty                    | Item is still readable; `extraction_error_code` is set; UI shows "Text extraction unavailable". |
| Re-running the pipeline                               | Idempotent: the queue's `UNIQUE (item_id, type)` constraint dedupes.     |
| Deleting a document                                 | Existing `DELETE /items/:id` cascade wipes assets, embeddings, tags.    |

## Free / local operation

Document Capture works with `AI_FREE_ONLY=true`:

- **PDF extraction:** `pdf-parse`, local Node, MIT.
- **TXT / Markdown extraction:** UTF-8 decode + sanitisation, no AI.
- **TLDR:** deterministic fallback produces a useful summary even with
  Ollama and Gemini turned off.
- **Embeddings:** optional. If `AI_EMBED_PROVIDER=ollama` and Ollama
  isn't running, search stays lexical-only.

No paid PDF parser, no Document AI, no Textract.

## See also

- `specs/api/capture.md` — exact request fields and error envelopes.
- `specs/api/search.md` — `kind=document` in `SEARCH_KINDS`.
- `docs/ai-architecture.md` — where extraction sits in the pipeline.
- `docs/spaces.md` — Smart Spaces for documents.