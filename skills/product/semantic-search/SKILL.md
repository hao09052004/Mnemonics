---
name: semantic-search
version: 0.1.0
source: hand-authored
status: draft
layer: skills
maturity: experimental
role: product
description: "Hybrid keyword + vector search over the tenant's corpus."
when_to_use: "any time /api/search receives a query"
inputs:
  - query string
  - tenant id
  - optional: filters { tags, kind, date_range }
outputs:
  - ranked list: [{ id, score, snippet, kind, captured_at }]
related_specs:
  - specs/api/search.md
  - specs/data/pgvector-config.md
related_agents:
  - agents/product/semantic-search-agent.md
  - agents/product/rag-pipeline-agent.md
gates:
  - quality-gates/gates/08-knowledge-regression.md
---

# Semantic search skill

## Procedure

1. Apply tenant isolation filter — `tenant_id = $current`. No exceptions.
2. Run keyword search (lex) over `documents.tsv` (Postgres FTS).
3. Run vector search (sem) via `document_embeddings`.
4. Reciprocal rank fusion (RRF), weights 0.4 lex / 0.6 sem.
5. Apply user filters (tags, kind, date).
6. Return top-N (default 20) with snippets.

## Anti-patterns

* Don't return results spanning tenants. CI enforces this via gate
  `08-knowledge-regression.md`.
