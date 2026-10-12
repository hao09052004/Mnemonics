# Core capture workflow

> **Status:** M1 of spec 0005 (core capture / classification / smart
> search). The capture pipeline is now metadata-rich; M2 reads
> `items.source_metadata` to feed the classifier.

## Sequence

```
  user clicks Save
        │
        ▼
  extension popup
        │
        ├── resolve current tab (chrome.tabs.query)
        │
        ├── extract page metadata
        │     ├── read og:title / og:description / og:image
        │     ├── read <link rel="canonical">
        │     ├── parse JSON-LD <script> blocks
        │     ├── run @mozilla/readability on a clone of the document
        │     └── SHA-256 the text content into a 16-byte content hash
        │
        ├── show "Reading page…" pill while in flight (4 s budget)
        │
        └── POST /api/v1/captures
              │
              ├── Zod validates the payload + source_metadata
              │   (strict; unknown keys are rejected with 400)
              │
              ├── repository.createPendingItem({ userId, capture, sourceMetadata })
              │   writes the row + items.source_metadata JSONB
              │
              ├── enqueue tag → embed → enrich (unchanged)
              │
              └── 201 { data: { id, status } }
```

The classifier (M2) is the only consumer of `items.source_metadata`
in this milestone. The memory detail view does not surface the
field yet.

## Bounded extraction

| Knob | Value | Reason |
|------|-------|--------|
| Readability timeout | 4 000 ms | Service workers must not block on a hostile page |
| Readability text cap | 100 000 chars | Memory ceiling; classifier re-reads the full text in M2 |
| Network read (service worker) | 3 500 ms | Prevents the popup waiting on a slow origin |
| Network read (web) | 3 000 ms | Same, with a tighter budget for the dashboard |
| Max HTML bytes | 400 000 | ~1 400 KB; larger pages are truncated, extraction still works |
| JSON-LD nodes | 20 | `@graph` graphs are flattened, not deep-walked |

A failed extraction **never** propagates to the user. The
`sourceMetadata` field is omitted from the payload and the memory
persists with `items.source_metadata IS NULL`.

## Data flow

```
   extension                  service worker                    API
  ─────────                  ──────────────                    ───
  currentPageUrl
        │
        │ chrome.runtime.sendMessage
        │  { type: 'EXTRACT_SOURCE_METADATA', url }
        ▼
                          fetch(url) ─────▶ raw HTML
                                │
                                ▼
                          jsdom(html)
                                │
                                ▼
                          extractPageMetadata(doc, url)
                                │
                                ▼
                          { ogTitle, ogDescription, … contentHash }
                                │
        sendResponse ◀──────────┘
        │
        ▼
  currentSourceMetadata = response.data
        │
        │  POST /api/v1/captures
        │  body.sourceMetadata = currentSourceMetadata
        ▼
                                              Zod parse
                                              │
                                              ▼
                                              repository.createPendingItem
                                              │
                                              ▼
                                              items.source_metadata JSONB
```

## Schema

`items.source_metadata` is `JSONB NULL` by default. M1 accepts the
following keys; M2 will read most of them:

```ts
{
  ogTitle?:         string,    // "Wooden Chair"
  ogDescription?:   string,    // short product blurb
  ogImage?:         string,    // https://…
  canonicalUrl?:    string,    // https://…
  jsonLd:           JsonLdNode[],   // up to 20 nodes
  article: {
    title?:         string,
    byline?:        string,
    excerpt?:       string,
    contentHtml?:   string,    // sanitized
    textContent?:   string     // <= 100 000 chars
  } | null,
  contentHash:      string     // "sha256:" + 32 hex chars
}
```

Unknown keys are rejected at the API boundary by `sourceMetadataSchema.strict()`.

## Migrations

- `packages/database/migrations/026_items_source_metadata.sql`
  adds the column and a GIN index on `jsonb_path_ops`. Idempotent,
  additive, no existing row is touched.

## What is NOT in M1

- The classifier (M2).
- The structured search filters (M3).
- The relevance benchmark (M4).
- A backwards-fill of `source_metadata` for memories that pre-date
  the migration. M4 will provide a one-shot script for opted-in
  operators.
