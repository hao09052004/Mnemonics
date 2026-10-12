# AI classification (M2 of spec 0005)

## What it does

Every captured item is classified by an async job. The job:

1. Reads the item (title + body + source metadata).
2. Calls the configured `ContentClassifier` (Gemini in Free-Tier
   mode, noop fallback otherwise).
3. Writes a single row to `item_classifications`.
4. Re-enqueues an `embed` job **only** when the AI description
   changed compared to the previous row.

## Why a separate table

- Search-time filtering needs a stable, structured field
  (`detected_type`, `attributes`, `category`). The classifier
  output is allowed to evolve over time without rewriting the
  canonical item.
- The classification status is independent of `items.status`.
  A Gemini failure must NEVER mark the item as `failed`. See
  `apps/api/src/jobs/handlers/classify.ts`.

## Provider selection

The factory in `packages/ai/src/providers/classification/index.ts`
picks the provider at boot:

| Condition                        | Provider                   |
| -------------------------------- | -------------------------- |
| `AI_FREE_ONLY=true` + Gemini key | `GeminiContentClassifier`  |
| anything else                    | `NoopContentClassifier`    |

We do **not** chain a second provider on a noop result (spec
0005 §4.4: no automatic paid-model fallback).

## Idempotence

The classify job is keyed on
`(item_id, classifier_version, content_hash)`. The handler
short-circuits when an existing row has the same `version` and
`content_hash`. Re-runs are safe.

## Re-enqueueing `embed`

`embed` is re-enqueued only when `result.description` differs
from the previous row's `description`. The spec forbids
automatic rescoring on classifier upgrade (`v1-no-rescore`).
This means upgrading from `v1` → `v2` does not retroactively
re-embed every item; only items whose new description actually
changes will re-embed.

## API

```
GET /api/v1/items/:id/classification
```

Returns the latest classification row, or 404 if no row exists
yet. The row may have any status; the web dashboard polls while
the status is non-terminal.

## Backfill

To classify items that pre-date migration 025:

```bash
pnpm --filter @mnemonics/api exec tsx scripts/backfill-classifications.mts \
    --dry-run --limit=200

BACKFILL_CONFIRM=YES pnpm --filter @mnemonics/api exec tsx scripts/backfill-classifications.mts \
    --limit=1000 --batch=50
```

The script refuses to run unless `BACKFILL_CONFIRM=YES` is
set, to prevent accidental mass enqueues from CI or a stray
shell.
