# API: extension captures

> Owner: `agents/product/capture-quality-agent.md`.

Until an API deployment is configured, the browser extension sends captures to
`http://localhost:4000`. The local API reads its `.env` configuration and writes
to the configured primary Supabase project. Chrome storage is not a durable
capture store or an API-list cache; it may hold screenshot bytes only while the
cropper is open.

All endpoints require the user's Supabase access token:

```http
Authorization: Bearer <access-token>
```

The service-role key is server-only and must never be shipped in the extension.

## Text and link captures

`POST /api/v1/captures` accepts JSON using the shared capture schema. Extension
requests use `type` (`link` or `text`), `title`, optional `sourceUrl`, optional
`selectedText`, optional `capturedAt`, and a stable UUID `clientRequestId`.
The same authenticated user and `clientRequestId` returns the existing item with
`200`; a new capture returns `201` and `{ "data": { "id", "status" } }`.

## Image and screenshot captures

`POST /api/v1/captures/image` accepts `multipart/form-data`:

- `file`: JPEG, PNG, or WebP, at most 10 MB.
- `title`: capture title.
- `note`, `sourceUrl`, and `capturedAt`: optional metadata.
- `clientRequestId`: stable UUID reused when the same in-memory save is retried.

The API stores bytes in the private `mnemonics-assets` Supabase Storage bucket at
`<user_id>/<item_id>/<filename>` and stores the user-scoped item and asset
metadata in Postgres. A failed request is reported to the user and is not
persisted as a local capture or retry record.

## Dashboard reads

`GET /api/v1/items?limit=50&offset=0` is the authoritative extension dashboard
read. It returns `{ "data": { "items", "total", "limit", "offset" } }`.
Rows include `status`, tags, and an expiring signed `image_url` for image assets.
The extension maps `image_url` to its render-ready `imageUrl`; server processing
status is distinct from the removed local `pendingUpload` sync state.

Legacy `mnemonics_items_<user_id>` rows explicitly marked
`pendingUpload === true` are discarded locally without calling an API delete.
No Supabase row or Storage object is deleted by that cleanup.
