---
name: search-query
version: 0.1.0
source: hand-authored
status: stable
layer: workflows
maturity: experimental
role: product
entry_state: intake
exit_state: closed
allowed_states: [intake, implement, verify, release, closed]
gates_used:
  - quality-gates/gates/01-style.md
  - quality-gates/gates/02-typecheck.md
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/04-security.md
  - quality-gates/gates/07-spec-sync.md
  - quality-gates/gates/08-knowledge-regression.md
agents_used:
  - agents/product/semantic-search-agent.md
  - agents/product/rag-pipeline-agent.md
skills_used:
  - skills/product/semantic-search/SKILL.md
  - skills/core/karpathy-guidelines/SKILL.md
related_specs:
  - specs/api/search.md
  - specs/data/pgvector-config.md
---

# Workflow: search-query

The Mnemonics query path: a user types into the dashboard → ranked results.

## Path

```
intake (user types query)
  ─▶ implement (lex + sem + RRF)
  ─▶ verify (gates including 08)
  ─▶ release
  ─▶ closed
```

## Stages (in `implement`)

```
[dashboard]                   [api]                              [db]
   │                            │                                │
   │ GET /api/search?q=... ────▶│                                │
   │                            │ lex (FTS) over documents.tsv   │
   │                            │ sem (vec) over doc_embeddings  │
   │                            │ RRF(lex=0.4, sem=0.6)          │
   │                            │ apply filters (tenant, tags, …) │
   │                            │ return top-N                    │
   │ ◀──────────────────────────│                                │
   │ render                     │                                │
```

If the caller is `rag-pipeline-agent`, results also feed
[`skills/product/semantic-search/SKILL.md`](../../skills/product/semantic-search/SKILL.md)'s
output to the prompt template in `packages/ai/prompts/`.

## Transitions

| From         | To         | Skill(s)                       | Gates                                            |
|--------------|------------|--------------------------------|--------------------------------------------------|
| intake       | implement  | semantic-search                | 05-agent-contract                                |
| implement    | verify     | semantic-search, karpathy      | 02-typecheck, 03-test-coverage                  |
| verify       | release    | verification-before-completion | 04-security, 07-spec-sync, 08-knowledge-regression |
| release      | closed     | —                              | —                                                |

## Required artefacts

1. p95 latency < 500 ms for top-20 at 100k items.
2. Recall@10 ≥ 0.85 on the golden set.
3. Tenant isolation: zero cross-tenant hits in 10k synthetic queries.

## Anti-patterns

* Loading embeddings on every request (no cache).
* Returning snippets that include credentials.
