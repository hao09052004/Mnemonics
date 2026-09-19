# API: tags

> Owner: `agents/product/ocr-tagger-agent.md`.
> Source-of-truth for tag generation.

## Tag schema

```jsonc
{
  "document_id": "uuid",
  "tags": ["lowercase-kebab", "lowercase-kebab"],   // 0..8 items
  "model": "string",
  "version": "string",
  "took_ms": 42
}
```

## Rules

* `tags[]` is **always** lowercase, kebab-case.
* `0 ≤ tags.length ≤ 8` (configurable per-tenant).
* Each tag must exist in `tenants.tag_whitelist` for that tenant.
* Tag length ≤ 32 chars.
* Empty or duplicate tags are dropped silently.

## Model registry

The list of supported tagger models lives in
[`../../apps/api/src/tagger/models.ts`](../../apps/api/src/tagger/models.ts).
Adding a model requires an ADR.

## Invariants

* Tagger **never** writes to `documents.body`, `documents.ocr_text`, or
  `documents.url`.
* Tagger **must** persist via `apps/api/src/tagger/persist.ts` only.

## Related

* Spec: [`../data/supabase-schema.md`](../data/supabase-schema.md)
  (the `tenants.tag_whitelist` column).
* Skill: [`../../skills/product/auto-tagging/SKILL.md`](../../skills/product/auto-tagging/SKILL.md).
