# Data: pgvector configuration

> Owner: `agents/product/semantic-search-agent.md`.
> Source-of-truth for vector storage and indexing.

## Embedding registry

| model name              | dim | provider       | notes                                 |
|-------------------------|-----|----------------|---------------------------------------|
| `text-embedding-3-small`| 1536 | openai         | default; cheapest                     |
| `text-embedding-3-large`| 3072 | openai         | higher quality                        |
| `bge-large-en-v1.5`     | 1024 | self-hosted    | offline fallback                      |

Adding a new model requires an ADR. Models are referenced by **string name** in
the `document_embeddings.model` column.

## Vector column

```sql
ALTER TABLE document_embeddings
  ADD COLUMN vector vector(<dim>);
```

`<dim>` is per model. Since Postgres allows one `vector(N)` per column, every
model that produces a different dimension requires either:

* a separate column (`vector_<model>`), or
* storing as `vector` (no dim) and validating in app code.

We use **separate columns** to leverage the ivfflat / hnsw indexes.

## Indexes

```sql
-- default model
CREATE INDEX doc_emb_3_small_idx
  ON document_embeddings
  USING ivfflat (vector_3small vector_cosine_ops)
  WITH (lists = 100);

-- ...one index per model
```

Index choice: `ivfflat` for ≤ 1M rows per tenant; switch to `hnsw` past that
threshold (ADR required).

## Distance

Cosine. The RRF in [`../api/search.md`](../api/search.md) uses
**1 - cosine_distance** as the sem score before fusion.

## Tenant isolation

Indexes do not bypass RLS; every query has `tenant_id = ...` injected via the
RLS policy.

## Operational metrics

* Recall@10 on the golden set, computed nightly.
* p95 search latency, computed per 15-min window.
* Drift between model versions, computed weekly.

These feed gate `08-knowledge-regression.md`.

## Related

* Spec: [`supabase-schema.md`](supabase-schema.md).
* API: [`../api/search.md`](../api/search.md).
* Skill: [`../../skills/product/embedding-generation/SKILL.md`](../../skills/product/embedding-generation/SKILL.md).
