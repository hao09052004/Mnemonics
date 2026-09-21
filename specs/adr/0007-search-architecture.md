# ADR 0007 — Search Architecture

> Status: Accepted (2026-09-20).
> Deciders: orchestrator, semantic-search-agent.

## Context

Users need to find items across:
- Title, raw text (selected text), OCR text
- Tags
- Date ranges
- Type filters

Pure SQL `LIKE` queries miss semantic context. Pure vector search misses exact keyword matches.

## Decision

We adopt **Hybrid Search with Reciprocal Rank Fusion (RRF)**:

### Components
1. **Lexical Search** - PostgreSQL FTS using `tsvector` + `ts_rank_cd`
2. **Semantic Search** - Vector similarity using pgvector `<=>` operator
3. **RRF Fusion** - Combines ranked results with weights 0.4 (lex) / 0.6 (sem)

### Searchable Text
- Auto-maintained trigger on `items` table
- Combines `title`, `raw_text`, `ocr_text`
- Uses `'simple'` config (no language-specific tokenization)

### Embeddings
- Model: `text-embedding-3-small` (1536 dimensions)
- Generated asynchronously via EmbedHandler
- Stored in `item_embeddings` table

### Algorithm
```
lex_weight = 0.4
sem_weight = 0.6
rrf_k = 60  # standard constant
```

## Alternatives Considered

- **Single vector search**: Misses keyword queries
- **ElasticSearch**: External dependency, cost
- **Pure SQL**: No semantic understanding

## Consequences

- Single source of truth (PostgreSQL)
- Tenant isolation via RLS
- Latency: p95 < 500ms at 100k items
- Both lexical and semantic queries work

## Performance

For 100k items per tenant:
- Lexical: < 50ms (GIN index)
- Semantic: < 200ms (IVFFlat index)
- RRF: < 10ms
- Total: < 300ms

## See also

- [Migration 005](../../packages/database/migrations/005_pgvector_search.sql)
- [Search Implementation](../../apps/api/src/routes/search.ts)
- [Spec: search.md](../api/search.md)
