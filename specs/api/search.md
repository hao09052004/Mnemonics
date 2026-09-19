# API: search

> Owner: `agents/product/semantic-search-agent.md`.
> Source-of-truth for any code path under `apps/api/search`.

## Endpoint

```
POST /api/search
Authorization: Bearer <jwt>
Content-Type: application/json
```

## Request body

```jsonc
{
  "q": "string",                       // required, 1..512 chars
  "filters": {
    "tags": ["string"],                // AND
    "kind": ["page", "selection", "image", "screenshot"],
    "captured_after":  "RFC3339",
    "captured_before": "RFC3339"
  },
  "limit": 20,                          // 1..100
  "offset": 0,                          // pagination
  "explain": false                      // if true, returns per-score breakdown
}
```

## Response

```jsonc
{
  "hits": [
    {
      "id": "uuid",
      "kind": "...",
      "title": "string",
      "snippet": "string",            // ~240 chars, sanitised HTML
      "score": 0.83,                   // post-RRF
      "captured_at": "RFC3339",
      "tags": ["string"]
    }
  ],
  "total": 137,                         // estimated total for paging
  "took_ms": 42
}
```

When `explain=true`, each hit adds:

```jsonc
{
  "score_components": {
    "lex": 0.61,
    "sem": 0.78,
    "rrf_lex": 0.0123,
    "rrf_sem": 0.0157,
    "rrf": 0.0280
  }
}
```

## Status codes

| Status | When                                                |
|--------|-----------------------------------------------------|
| 200    | OK.                                                 |
| 400    | Validation failed (`q` missing/too long, bad dates). |
| 401    | Missing/invalid JWT.                                |
| 5xx    | Internal error.                                     |

## Algorithm

Lex + sem with **Reciprocal Rank Fusion** (RRF). Weights are fixed:

```
lex_weight = 0.4
sem_weight = 0.6
rrf_k      = 60     # standard
```

A query whose lex or sem returns nothing still gets a result — the other half
contributes alone. Score is renormalised to [0, 1].

## Tenant isolation

All queries carry an implicit `tenant_id = auth.uid()` filter via Supabase
RLS. Gate [`../../quality-gates/gates/08-knowledge-regression.md`](../../quality-gates/gates/08-knowledge-regression.md)
synthesises 10 000 cross-tenant probes and asserts zero hits.

## Latency budget

* p95 < 500 ms at 100k documents / tenant.
* p99 < 1 s.

## Related

* Skill: [`../../skills/product/semantic-search/SKILL.md`](../../skills/product/semantic-search/SKILL.md).
* Spec: [`data/pgvector-config.md`](../data/pgvector-config.md).
* Workflow: [`../../workflows/product/search-query.md`](../../workflows/product/search-query.md).
