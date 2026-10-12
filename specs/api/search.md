# API: search

> Owner: `agents/product/semantic-search-agent.md`.
> Source-of-truth for any code path under `apps/api/search`.

## Endpoint

```
POST /api/v1/search
Authorization: Bearer <jwt>
Content-Type: application/json
```

## Request body

```jsonc
{
  "q": "string",                       // optional when filters carry meaning
  "filters": {
    "tags": ["string"],                // AND
    "kind": ["link", "text", "image", "screenshot", "document"],
    "captured_after":  "RFC3339",
    "captured_before": "RFC3339",
    "favorite": true,
    "structured": {                    // M3 — spec 0005 §7.1
      "detectedType": ["article","product","recipe","video","quote","highlight","webpage","image","note","document","other"],
      "category":  ["string"],
      "brand":     ["string"],
      "material":  ["string"],
      "color":     ["string"],
      "merchant":  ["string"],
      "author":    ["string"]
    }
  },
  "limit": 20,                          // 1..100
  "offset": 0,                          // pagination
  "explain": false                      // if true, returns per-score breakdown
}
```

A natural-language `q` (e.g. `recipes this week` or
`brand:ikea material:wood`) is parsed by the deterministic
query parser in `@mnemonics/database/query-parser`. The
parser extracts structured tokens and a residual `q` for
the semantic leg. Existing explicit filter values always
win over parser output.

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

The top-level `explain` payload also reports leg counts and
weights (M3 adds the structured leg):

```jsonc
{
  "explain_data": {
    "lexResults": 12,
    "semResults": 7,
    "chunkResults": 0,
    "structResults": 4,
    "weights": { "lex": 0.4, "sem": 0.6, "struct": 0.5 }
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

Lex + sem + structured with **Reciprocal Rank Fusion** (RRF). Weights are
exported from `@mnemonics/database/search-service` so the M4 benchmark can
sweep them:

```
lex_weight    = 0.4
sem_weight    = 0.6
struct_weight = 0.5     // M3 — spec 0005 §7.2
rrf_k         = 60      // standard
```

A query whose lex, sem, or structured leg returns nothing still gets a
result — the other legs contribute alone. Score is the sum of leg
contributions in [0, 1+].

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
