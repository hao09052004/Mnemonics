# API: ocr

> Owner: `agents/product/ocr-tagger-agent.md`.
> Source-of-truth for the OCR job contract invoked from `apps/api/capture`.

## Job payload

```jsonc
{
  "document_id": "uuid",
  "tenant_id": "uuid",                 // redundant with document, for sharding
  "engine": "tesseract" | "google-vision" | "<ad-hoc>",
  "model_version": "string",
  "budget_ms": 30000                   // hard ceiling, defaults to 30s
}
```

## Job result

```jsonc
{
  "document_id": "uuid",
  "status": "ok" | "failed",
  "ocr_text": "string",
  "ocr_confidence": 0.93,              // [0,1], engine-specific
  "engine": "...",
  "model_version": "...",
  "took_ms": 412,
  "error": null | { "code": "ocr_timeout" | "ocr_engine_error", "message": "..." }
}
```

## Engine registry

The list of supported engines lives in
[`../../apps/api/src/ocr/engines.ts`](../../apps/api/src/ocr/engines.ts).
Adding a new engine requires an ADR; this spec only references it by name.

## Invariants

* `documents.status` after OCR: `'processing'` (intermediate) and then `'ready'`
  if OCR is the last job, otherwise `processing` until tag + embed finish.
* OCR failures set `documents.status='failed'` and `documents.error.code='ocr_*'`.

## See also

* Skill: [`../../skills/product/ocr-pipeline/SKILL.md`](../../skills/product/ocr-pipeline/SKILL.md).
* Workflow: [`../../workflows/product/capture-to-knowledge.md`](../../workflows/product/capture-to-knowledge.md).
