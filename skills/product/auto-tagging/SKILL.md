---
name: auto-tagging
version: 0.1.0
source: hand-authored
status: draft
layer: skills
maturity: experimental
role: product
description: "Generate a deterministic tag set for a captured document."
when_to_use: "after OCR succeeds on image/screenshot, or on first save of text/page"
inputs:
  - documents row (with ocr_text or body)
  - tenant id
outputs:
  - array of tag strings, stored on documents.tags
related_specs:
  - specs/data/supabase-schema.md
  - specs/api/tags.md
related_agents:
  - agents/product/ocr-tagger-agent.md
gates:
  - quality-gates/gates/03-test-coverage.md
---

# Auto-tagging skill

## Procedure

1. Validate input row.
2. Resolve tagger from `specs/api/tags.md`. Refuse if unknown.
3. Generate tags (caller-supplied budget, default 8 tags).
4. Normalise tags (lowercase, dedup, drop empty). Drop tags longer than 32 chars.
5. Persist `documents.tags` via the tagging service only.

## Anti-patterns

* Don't invent tags from the document title alone — read the body.
* Don't exceed the per-tenant tag whitelist in `specs/data/supabase-schema.md`.
