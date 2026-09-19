---
name: ocr-pipeline
version: 0.1.0
source: hand-authored
status: draft
layer: skills
maturity: experimental
role: product
description: "Run OCR on a captured image or screenshot and persist extracted text + tags."
when_to_use: "any time the capture API enqueues an OCR job"
inputs:
  - file URL or path (signed)
  - tenant id
  - model spec from specs/api/ocr.md
outputs:
  - updated documents row: ocr_text, ocr_status, ocr_engine, ocr_confidence
related_specs:
  - specs/api/ocr.md
  - specs/data/supabase-schema.md
related_agents:
  - agents/product/ocr-tagger-agent.md
gates:
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/07-spec-sync.md
---

# OCR pipeline skill

Deterministic procedure for converting an image-capture row in state `pending`
into a `ready` row with `ocr_text` populated.

## Procedure

1. Read the row at `documents.id` and confirm `documents.status = 'pending'` and
   `documents.kind IN ('image', 'screenshot')`. Otherwise exit with `noop`.
2. Resolve OCR backend per `specs/api/ocr.md`. Refuse if engine is unknown.
3. Call OCR with a 30-second budget. On timeout, mark `status='failed'` with
   `error.code='ocr_timeout'`.
4. Persist `ocr_text`, `ocr_engine`, `ocr_confidence`. Update `status='processing'`
   then enqueue tagging (skill: `auto-tagging`).
5. Tagging finishes → `status='ready'`.

## Anti-patterns

* Don't fall back to a different OCR engine silently. Surface the failure.
* Don't write to `documents.tags` from this skill.
