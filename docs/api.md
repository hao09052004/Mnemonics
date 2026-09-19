# API Contract

The API prefix is `/api/v1`.

Initial endpoints:

- `POST /auth/register` (Supabase Auth)
- `POST /auth/login` (Supabase Auth)
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /captures`
- `GET /items`
- `GET /items/:id`
- `POST /search`
- `POST /items/:id/retry`
- `GET /health`

All item, asset, tag and embedding queries must be scoped to the authenticated user's `user_id`.

## Authentication

Register and login accept JSON `{ "email": "...", "password": "...", "name": "..." }` (name is only used for register). Successful responses return `data.user` and `data.session.accessToken`. Send that access token as `Authorization: Bearer <token>` to protected endpoints.

New users have role `user`. The API recognizes `admin` from the trusted Supabase `app_metadata.role` claim; the profile migration also stores the role for server-side provisioning.

## Implemented capture endpoint

`POST /api/v1/captures` requires `Authorization: Bearer <access-token>` and accepts the shared `link`, `text` and `image` contract. A valid request returns `201` with an item ID and `pending` status. Repeating the same `clientRequestId` for the same authenticated user returns the existing item with `200`.

Image captures must provide a storage reference, MIME type and byte size. Base64/data URLs are rejected until object storage is available.

## Image upload endpoint

`POST /api/v1/captures/image` accepts `multipart/form-data`:

- `file`: JPEG, PNG or WebP, maximum 10 MB
- `title`: capture title
- `note`: optional note
- `sourceUrl`: optional source URL
- `capturedAt`: optional ISO timestamp
- `clientRequestId`: UUID for idempotency

The server uploads the file to the private `mnemonics-assets` bucket using the path `<user_id>/<item_id>/<filename>`, then stores only the storage key and metadata in PostgreSQL. The extension uses `chrome.storage.local` only as temporary transport while the cropper is open; the final image is not stored there.