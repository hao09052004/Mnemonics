# API: capture

> Owner: `agents/product/capture-quality-agent.md`.
> Source-of-truth for any code path under `apps/api/capture`.

## Endpoint

```
POST /api/capture
Authorization: Bearer <jwt>          # Supabase user JWT, never in URL
Content-Type: application/json
```

## Request body

```jsonc
{
  "kind": "page" | "selection" | "image" | "screenshot",
  "url": "https://...",              // required for page and screenshot
  "title": "string",                 // optional, server falls back to <title>
  "selection_html": "string",        // required when kind=selection
  "selection_text": "string",        // required when kind=selection
  "image_base64": "string",          // required when kind=image
  "screenshot_url": "string",        // required when kind=screenshot, signed
  "captured_at": "RFC3339",          // client-side timestamp, server may correct
  "redact": ["email", "phone", "token"]  // extension-side redaction list
}
```

### Field rules

* `kind` must be one of the four enums; unknown kinds → `400 kind_unknown`.
* `redact` items are matched by regex on `selection_text` and `title` server-side
  as a defence-in-depth measure (the extension redacts first).
* All binary payloads are stored in Supabase Storage; the row references them by URL.

## Response

### 2xx

```jsonc
{
  "id": "uuid",
  "status": "pending",   // pending | processing | ready | failed
  "kind": "...",
  "captured_at": "...",
  "queued_jobs": ["ocr", "tag", "embed"]   // subset of {ocr, tag, embed}
}
```

### 4xx / 5xx

```jsonc
{
  "error": {
    "code": "kind_unknown" | "auth_required" | "tenant_unknown"
           | "rate_limited" | "payload_too_large" | "internal_error",
    "message": "string",
    "request_id": "uuid"
  }
}
```

## Status codes

| Status | When                                                           |
|--------|----------------------------------------------------------------|
| 201    | Captured. `status='pending'`.                                  |
| 200    | Captured but already known (deduplicated).                     |
| 400    | Validation failed.                                             |
| 401    | Missing or invalid JWT.                                        |
| 403    | Tenant mismatch.                                               |
| 413    | `payload_too_large` (default 4 MiB for images).                |
| 429    | `rate_limited` (per-tenant, per-minute).                       |
| 5xx    | Internal error. `request_id` returned for debugging.           |

## Side effects

1. Insert `documents` row with `status='pending'`.
2. Enqueue OCR job **iff** `kind in ('image','screenshot')`.
3. Always enqueue tag + embed jobs (worker picks them up after pending → processing).

## Idempotency

* The same `(tenant_id, url, selection_hash)` within 60s returns `200` with the
  existing `id`.

## Security

* All requests are RLS-scoped to `auth.uid()`'s tenant.
* `image_base64` is rejected if base64-decoded size > 4 MiB.
* `selection_html` is sanitised server-side; `<script>` tags removed.

## Related

* Skill: [`../../skills/product/capture-extension/SKILL.md`](../../skills/product/capture-extension/SKILL.md).
* Spec: [`0001-system-overview.md`](../0001-system-overview.md), [`data/supabase-schema.md`](../data/supabase-schema.md).
* Workflow: [`../../workflows/product/capture-to-knowledge.md`](../../workflows/product/capture-to-knowledge.md).
