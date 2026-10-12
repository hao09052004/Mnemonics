---
name: capture-to-knowledge
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
  - agents/product/capture-quality-agent.md
  - agents/product/ocr-tagger-agent.md
  - agents/product/semantic-search-agent.md
  - agents/product/knowledge-graph-agent.md
skills_used:
  - skills/product/capture-extension/SKILL.md
  - skills/product/ocr-pipeline/SKILL.md
  - skills/product/auto-tagging/SKILL.md
  - skills/product/embedding-generation/SKILL.md
  - skills/core/test-driven-development/SKILL.md
  - skills/core/karpathy-guidelines/SKILL.md
related_specs:
  - specs/api/capture.md
  - specs/api/ocr.md
  - specs/api/tags.md
  - specs/api/search.md
  - specs/data/supabase-schema.md
  - specs/data/pgvector-config.md
---

# Workflow: capture-to-knowledge

The Mnemonics-specific happy path: a click in the browser ends with a queryable
item in the user's knowledge base.

## Path

```
intake (user clicks capture)
  ─▶ implement (capture → OCR → tag → embed)
  ─▶ verify (gates)
  ─▶ release (search can find it)
  ─▶ closed
```

## Pipeline stages (in `implement`)

```
[extension]                          [api]                       [ai]                  [db]
   │                                    │                           │                    │
   │ POST /api/capture ────────────────▶│                           │                    │
   │                                    │ insert documents row      │                    │
   │                                    │ status='pending' ───────────────────────────▶│
   │                                    │                                              │
   │                                    │ enqueue OCR job (if image)                   │
   │                                    │ ─── skill: ocr-pipeline ─▶ [ocr]             │
   │                                    │ ◀──── ocr_text ─────────────                  │
   │                                    │ update ocr_status='done'                     │
   │                                    │                                              │
   │                                    │ enqueue tag job                              │
   │                                    │ ─── skill: auto-tagging ─▶ [tagger]          │
   │                                    │ ◀──── tags[] ────────────────                 │
   │                                    │ update tags                                  │
   │                                    │                                              │
   │                                    │ enqueue embed job                            │
   │                                    │ ─── skill: embedding-generation ─▶ [embed]   │
   │                                    │ ◀──── vector ──────────────────               │
   │                                    │ insert document_embeddings row ─────────────▶│
   │                                    │ status='ready'                               │
```

## Transitions

| From         | To         | Skill(s)                              | Gates                                           |
|--------------|------------|---------------------------------------|-------------------------------------------------|
| intake       | implement  | capture-extension                     | 05-agent-contract                               |
| implement    | verify     | ocr-pipeline, auto-tagging, embedding-generation | 01-style, 02-typecheck, 03-test-coverage |
| verify       | release    | verification-before-completion        | 07-spec-sync, 08-knowledge-regression           |
| release      | closed     | —                                     | —                                               |

## Required artefacts

1. `documents.status = 'ready'` for ≥ 99% of captures over a 24h window.
2. End-to-end test: extension click → queryable in dashboard.
3. Run record at `workflows/runs/YYYY-MM-DD-capture-pipeline.md`.

## Anti-patterns

* Calling OCR/Tagger/Embed synchronously from the capture endpoint.
* Mixing tenants in `document_embeddings`.
* Returning 200 before embedding is persisted.
