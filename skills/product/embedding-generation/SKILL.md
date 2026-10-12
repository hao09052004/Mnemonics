---
name: embedding-generation
version: 0.1.0
source: hand-authored
status: draft
layer: skills
maturity: experimental
role: product
description: "Compute and persist an embedding for a documents row."
when_to_use: "after a document is ready (ocr_text or body present)"
inputs:
  - documents row id
  - tenant id
outputs:
  - row in document_embeddings(tenant_id, document_id, vector, model, dim)
related_specs:
  - specs/data/pgvector-config.md
related_agents:
  - agents/product/semantic-search-agent.md
gates:
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/07-spec-sync.md
---

# Embedding generation skill

## Procedure

1. Confirm `documents.status = 'ready'`.
2. Resolve embedding model from `specs/data/pgvector-config.md`. Confirm `dim`
   matches the target table column.
3. Truncate input to model context window (leave 10% headroom).
4. Persist row. If a previous embedding exists for the same `(document_id, model)`,
   overwrite in the same transaction.
5. Mark `documents.embedding_status='embedded'`.

## Anti-patterns

* Don't change models without an ADR. Embedding drift is silent and catastrophic.
