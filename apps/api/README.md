# API

Node.js/Express service for the first capture milestone.

## Run

```powershell
pnpm --filter @mnemonics/api dev
```

The service listens on port `4000` and exposes:

- `GET /api/v1/health`
- `POST /api/v1/captures`
- `POST /api/v1/captures/image` (`multipart/form-data`, field `file`)

The current auth middleware accepts the development token from `DEV_AUTH_TOKEN`, or `mnemonics-dev-token` when unset. This is only a development boundary; production register/login/refresh is not implemented yet.

Apply `packages/database/migrations/001_create_items.sql` before using the real PostgreSQL repository.

The capture route validates shared Zod contracts, requires a bearer token, returns `pending` immediately and uses `clientRequestId` for idempotency. It does not run OCR, tagging or embeddings.

The image route uploads the file to the private Supabase Storage bucket first, then creates the `items` and `assets` rows in a database transaction. If the database write fails, the uploaded object is removed. The service role key is used only by this server and is never sent to the extension.