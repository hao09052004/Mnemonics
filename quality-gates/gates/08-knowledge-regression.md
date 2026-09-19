# Gate 08 — Knowledge regression

* **Owner:** `agents/product/semantic-search-agent.md` (with code-reviewer)
* **Runner:** `../runners/knowledge-regression.mjs`
* **Fires on:** any change under `apps/api/search/`, `packages/ai/embed/`,
  `packages/ai/tagger/`, or `specs/data/pgvector-config.md`. Also nightly.
* **Failure semantics:** blocks transitions `verify → release` for the
  `search-query` and `capture-to-knowledge` workflows.

## Rule

On a labelled golden set of (query, expected document ids):

* **Recall@10 ≥ 0.85** across the suite.
* **Tenant isolation:** zero hits across 10 000 synthetic cross-tenant probes.
* **Latency:** p95 < 500 ms at 100 k items per tenant in the staging
  environment.

## Evidence

Per-run report at `quality-gates/.coverage/08-knowledge-regression-<date>.json`,
plus an HTML summary for humans.

## Remediation

1. If recall drops: investigate the diff. Most regressions come from
   embedding-model changes (see `specs/data/pgvector-config.md`).
2. If tenant isolation fails: stop the deploy, treat as sev-1.
3. If latency regresses: re-check index choices; consider HNSW.
