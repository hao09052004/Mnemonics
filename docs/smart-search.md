# Smart Search & Smart Spaces (M3)

This document covers the search layer that M3 adds on top of
the existing lexical + semantic + chunk hybrid retrieval.

## What changed

M3 introduces a new `structured` filter group and a new
`structured` retrieval leg. A natural-language query like
`recipes this week` is parsed deterministically into:

- `filters.structured.detectedType = ['recipe']`
- `filters.captured_after` / `filters.captured_before` set to
  a 7-day window ending now.

The two filter groups feed the same `runSearch()`:

| Group         | Lives in                                        | Read by                     |
|---------------|--------------------------------------------------|-----------------------------|
| `tags`        | `item_tags` (M1)                                 | lexical leg                 |
| `kind`        | `items.type`                                     | lexical leg                 |
| `dates`       | `items.captured_at`                              | lexical + structured leg    |
| `favorite`    | `items.favorite`                                 | lexical leg                 |
| `structured`  | `item_classifications.{detected_type, attributes}`| **new** structured leg     |

## The `structured` leg

```ts
const STRUCT_WEIGHT = 0.5; // exported from @mnemonics/database/search-service
```

The leg runs one SQL query that joins `items` to
`item_classifications`. Each row's score is the count of
matched structured keys divided by the total number of
requested keys (1.0 = perfect match). The leg is empty
when:

- `filters.structured` is absent, or
- All of its keys are empty arrays, or
- The user has zero `item_classifications` rows for the
  requested keys.

An empty leg is not an error.

The leg feeds the same reciprocal-rank fusion as the
existing lexical and semantic legs:

```
final_score(item) =
    LEX_WEIGHT * (1 / (60 + lex_rank + 1))
  + SEM_WEIGHT * (1 / (60 + sem_rank + 1))
  + STRUCT_WEIGHT * (1 / (60 + struct_rank + 1))
```

with `LEX_WEIGHT = 0.4`, `SEM_WEIGHT = 0.6`,
`STRUCT_WEIGHT = 0.5`. Constants live in
`packages/database/src/search-service.ts` and the M4
benchmark can sweep them.

## The query parser

`parseQuery(input, now?)` is a pure function in
`@mnemonics/database/query-parser`. It recognises:

| Phrase                            | Becomes                                                  |
|-----------------------------------|----------------------------------------------------------|
| `today` / `yesterday`             | `captured_after` / `captured_before`                     |
| `this week` / `last week`         | 7-day window ending/starting at the closest Sunday       |
| `this month` / `last month`       | calendar-month window                                    |
| `N days ago` / `N weeks ago` / `N months ago` | `now - N * unit`                                  |
| `after YYYY-MM-DD` / `before YYYY-MM-DD` | ISO date window                                    |
| `articles` / `videos` / `recipes` / `products` / `quotes` / `highlights` / `notes` / `images` / `documents` / `webpages` | `filters.structured.detectedType` |
| `brand:foo` / `material:bar` / `color:baz` / `merchant:qux` / `author:quux` | `filters.structured.{key}`        |
| anything else                     | `q` (residual, sent to the semantic leg)                |

Confidence gate: a structured key with two different values
(e.g. `brand:foo brand:bar`) is dropped, not silently
AND-ed into an empty result.

## Smart Spaces

A Smart Space is a saved `SearchRequest`. The web dashboard
and the extension popup both call `POST /api/v1/spaces`
with the active `SearchRequest` body. The server stores the
rule and resolves it through `runSearch()` via
`resolveSmartSpaceIds()`. The same request drives the Space
on every open, so a memory captured after the Space was
created appears in it on the next read.

"Save as Space" buttons:

- Web dashboard's Everything view (existing).
- Web extension popup (M3).
- Memory detail view, scoped to "memories like this one"
  (M3).

## Backward compatibility

`SearchFilters.structured` is optional. Old saved Smart
Spaces (without `structured`) and old search requests pass
through unchanged. The structured leg is empty in that case
and the existing two-leg ranking wins.

## Failure modes

| Stage                          | Behaviour                                            |
|--------------------------------|------------------------------------------------------|
| `embedOne` returns null        | lexical + structured legs run; semantic + chunk legs empty |
| `item_classifications` empty   | structured leg is empty; the other legs win          |
| Contradictory structured key   | the key is dropped; no error                         |
| No `q` and no filters          | 400 INVALID_SEARCH_REQUEST                           |

## Endpoints

| Method | Path                         | Notes |
|--------|------------------------------|-------|
| `POST` | `/api/v1/search`             | body: `{ q, filters, limit, offset, explain }` |
| `GET`  | `/api/v1/search?q=…`         | convenience for a bare keyword |
| `POST` | `/api/v1/spaces`             | save a `SearchRequest` as a Smart Space |
| `GET`  | `/api/v1/spaces/:id/members` | resolves through `runSearch()` |

The dashboard's `Filters` → `Detected` chip group is the
user-visible face of the structured filter set. Each chip
toggle calls the same `runSearch()` with the new
`detectedType` value appended to `filters.structured.detectedType`.
