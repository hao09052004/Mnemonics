# Data: Supabase schema

> Owner: `agents/product/capture-quality-agent.md` (co-owns with db).
> Source-of-truth for the Postgres schema under `packages/database/`.

This is the *contract*; the actual migration files live in
`packages/database/migrations/`. Any divergence is a bug.

## Tables

### `tenants`

| column        | type        | notes                          |
|---------------|-------------|--------------------------------|
| `id`          | uuid PK     |                                |
| `name`        | text        |                                |
| `created_at`  | timestamptz | default now()                  |
| `plan`        | text        | `free` \| `pro`                |

### `documents`

| column            | type        | notes                                       |
|-------------------|-------------|---------------------------------------------|
| `id`              | uuid PK     |                                             |
| `tenant_id`       | uuid FK     | NOT NULL → `tenants.id`                     |
| `kind`            | text        | `page` \| `selection` \| `image` \| `screenshot` |
| `url`             | text        | nullable for non-page kinds                 |
| `title`           | text        |                                             |
| `body`            | text        | plain text, max 1 MiB                       |
| `ocr_text`        | text        | nullable                                    |
| `tags`            | text[]      | normalised; see tags contract               |
| `status`          | text        | `pending` \| `processing` \| `ready` \| `failed` |
| `error`           | jsonb       | `{ code, message }` when failed             |
| `captured_at`     | timestamptz |                                             |
| `created_at`      | timestamptz | default now()                               |
| `updated_at`      | timestamptz | trigger-updated                             |

Indexes:

* `(tenant_id, status)` — for workers.
* `(tenant_id, captured_at DESC)` — for dashboards.
* `GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(ocr_text,'')))` — for FTS.
* `GIN (tags)` — for tag filters.

### `document_embeddings`

| column          | type        | notes                                       |
|-----------------|-------------|---------------------------------------------|
| `id`            | uuid PK     |                                             |
| `tenant_id`     | uuid        | denormalised; equal to parent document's    |
| `document_id`   | uuid FK     | UNIQUE with `model`                         |
| `model`         | text        | e.g. `text-embedding-3-small`               |
| `dim`           | int         | must match model registry                   |
| `vector`        | vector(`dim`) |                                         |
| `created_at`    | timestamptz | default now()                               |

UNIQUE `(document_id, model)`.

### `edges` (knowledge graph)

| column        | type        | notes                                  |
|---------------|-------------|----------------------------------------|
| `id`          | uuid PK     |                                        |
| `tenant_id`   | uuid        |                                        |
| `from_id`     | uuid FK     | → `documents.id`                       |
| `to_id`       | uuid FK     | → `documents.id`                       |
| `type`        | text        | typed enum (ADR-controlled)            |
| `attrs`       | jsonb       | type-specific attributes               |
| `created_at`  | timestamptz |                                        |

UNIQUE `(tenant_id, from_id, to_id, type)`.

### `documents_status_history`

Append-only audit of status transitions. Schema is identical to a subset of
`documents` plus `changed_at` and `changed_by`.

## RLS

* Every table has RLS enabled.
* Policy: `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`.
* Service-role keys (workers) bypass RLS. The `apps/api` workers must run with
  service-role only on the **worker** path, never on user-facing endpoints.

## Per-tenant tag whitelist

Stored as `tenants.tag_whitelist text[]`. Tag inserter rejects any tag not in
the whitelist; admin can update via RLS-protected endpoint.

## Migration discipline

* One migration per logical change. No combining.
* Every migration is reversible (`up` + `down`).
* Migrations must pass the schema-sync gate
  [`../../quality-gates/gates/07-spec-sync.md`](../../quality-gates/gates/07-spec-sync.md).

## Related

* API: [`../api/capture.md`](../api/capture.md), [`../api/search.md`](../api/search.md).
* Spec: [`pgvector-config.md`](pgvector-config.md).
