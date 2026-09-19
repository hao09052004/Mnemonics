# Spec 0001 — System overview

> **Status:** Authoritative. Supersedes and extends `docs/architecture.md`.
> **Owner:** `agents/core/code-reviewer.md` must sign off on changes.

## 1. Purpose

Mnemonics is a personal-knowledge-management SaaS. The user captures items
from the browser; Mnemonics ingests, organises, indexes, and retrieves them.

**One-line value prop:** *Save once — find anytime.*

## 2. Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser                                   │
│                                                                     │
│   ┌──────────────────┐      ┌──────────────────────┐                │
│   │ Manifest V3 ext  │ ───▶ │  Content scripts     │                │
│   │  apps/extension  │ ◀─── │  (selection, image,  │                │
│   └──────────────────┘      │   page, screenshot)  │                │
│                             └──────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ POST /api/capture
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            apps/api                                  │
│                                                                     │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐                │
│   │ capture    │    │ ocr        │    │ search     │                │
│   │ endpoint   │    │ endpoint   │    │ endpoint   │                │
│   └────────────┘    └────────────┘    └────────────┘                │
│        │                 │                 │                        │
│        └────────┬────────┴────────┬────────┘                        │
│                 ▼                 ▼                                 │
│            ┌──────────────────────────┐                             │
│            │       packages/ai        │                             │
│            │  (tagger, embedder, …)   │                             │
│            └──────────────────────────┘                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Supabase (Postgres + pgvector)                 │
│                                                                     │
│   documents • document_embeddings • edges (graph) • tsv (FTS)       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                ▲
                                │
                                │ GET /api/search
                                │
┌─────────────────────────────────────────────────────────────────────┐
│                          apps/web (React dashboard)                  │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. P0 (MVP) scope

* Browser extension (Manifest V3) on Chrome/Firefox.
* Capture API accepting: page, selection, image, screenshot.
* OCR for images.
* Auto-tagging (small tag set per document).
* Embedding + pgvector.
* Web dashboard with keyword + semantic search.
* Per-tenant data isolation via Supabase RLS.

States for any captured item:

```
pending ──▶ processing ──▶ ready
   │             │
   └─────────────┴─────▶ failed
```

## 4. P1 (Beta) scope

See [`docs/architecture.md`](../../docs/architecture.md) for the full list.

## 5. Information architecture (this repo)

This repository follows the five-layer architecture documented in
[`../AGENTS.md`](../AGENTS.md):

* `agents/` — who acts.
* `skills/` — how they act.
* `workflows/` — when and in what order.
* `specs/` — what the contract is. **← this layer**
* `quality-gates/` — is it good enough.

## 6. Threat model (high-level)

* **Tenant isolation:** RLS is the security boundary. Any code path that
  bypasses RLS is a sev-1.
* **Auth tokens:** never logged, never sent in URLs, rotated on suspicion.
* **PII:** extension must redact `email`, `phone`, `token`-shaped strings
  before sending to `apps/api`.
* **Cross-tenant queries:** semantic-search must always include `tenant_id`
  in WHERE clause. Gate `08-knowledge-regression.md` enforces this.

## 7. Data flow invariants

1. Every `documents` row has exactly one `tenant_id`.
2. Every `document_embeddings` row has exactly one `tenant_id`, equal to the
   parent document's `tenant_id`.
3. `documents.status` transitions are append-only in `documents_status_history`.
4. Embedding model is recorded on every `document_embeddings` row.

## 8. Quality gates per release

Every release must pass all eight gates defined in
[`../quality-gates/gates/`](../quality-gates/gates).

## 9. See also

* [`specs/api/capture.md`](api/capture.md), [`specs/api/search.md`](api/search.md).
* [`specs/data/supabase-schema.md`](data/supabase-schema.md),
  [`specs/data/pgvector-config.md`](data/pgvector-config.md).
* [`workflows/state-machine.md`](../workflows/state-machine.md) — the state
  machine every workflow follows.
* ADR [`0001-agents-skills-workflows-layout.md`](adr/0001-agents-skills-workflows-layout.md).
