# API Contract

The API prefix is `/api/v1`. While the product is undeployed, the extension
calls `http://localhost:4000`; that local process connects through `.env` to the
configured primary Supabase project. This is not a claim that a public API URL
exists.

Protected routes require the user's Supabase token in
`Authorization: Bearer <access-token>`. The Supabase service-role key remains in
the API environment and is never exposed to the extension.

## Extension capture flow

- `POST /api/v1/captures` accepts JSON link/text captures and returns `201` for a
  new item or `200` when the authenticated user's stable `clientRequestId` was
  already accepted.
- `POST /api/v1/captures/image` accepts multipart JPEG, PNG, or WebP bytes (up to
  10 MB) plus `title`, optional `note`, optional `sourceUrl`, optional
  `capturedAt`, and `clientRequestId`.
- Image bytes are written to the private `mnemonics-assets` bucket under the
  authenticated user's prefix; metadata is written to Postgres.
- `GET /api/v1/items` returns the user-scoped dashboard list in
  `{ data: { items, total, limit, offset } }`. Image rows contain an expiring
  signed `image_url` suitable for rendering.

The server response is the save boundary. API rejection is shown as an error and
does not create a Chrome-storage capture or retry queue. Chrome storage remains
available for auth/session, preferences, reminders, and temporary screenshot
transport while the cropper is open; it is not used for saved captures or API
item snapshots.

Other implemented routes include auth, item detail/delete/related operations,
search, retry processing, and `GET /health`.
