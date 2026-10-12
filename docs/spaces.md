# Spaces

Spaces are first-class, **server-backed** collections of memories.
They replace the legacy extension-local prototype: there is no
`SPACES_DATA`, no hardcoded Space list, and no second implementation.
The Chrome/Edge dashboard reads the same `/api/v1/spaces` endpoints
as the web app.

> A Smart Space is a *saved search*, not an AI feature. Nothing in
> this document calls Gemini, OpenAI or Ollama to build a Space.

## Types

| Type   | Storage                | Membership                              |
|--------|------------------------|-----------------------------------------|
| manual | `space_items`          | explicit, persisted per membership      |
| smart  | `spaces.rule` (JSONB)  | computed at read time from the criteria |

Both live in the same `spaces` table; `space_type` disambiguates.
`space_items` is only ever written for `manual`.

## How a smart Space stays up to date

```
smart Space row  ->  spaces.rule (a SearchRequest)
                 ->  resolveSmartSpaceIds()          packages/database/src/search-service.ts
                 ->  runSearch()                     hybrid: FTS + pgvector + RRF
                 ->  matching memory ids
```

`resolveSmartSpaceIds` calls the **same** `runSearch` that
`GET /api/v1/search` uses, so a saved query produces the same
results as typing it into Everything. No ids are copied, no
background job runs, and a memory captured *after* the Space was
created shows up on the next read because the rule is re-executed.

`rule` is validated as a real `SearchRequest`:

```jsonc
{
  "q": "logo",
  "filters": {
    "kind": ["image"],
    "tags": ["design"],
    "favorite": null,
    "captured_after": "2026-01-01T00:00:00.000Z"
  }
}
```

A rule must carry at least one real constraint — a Smart Space
matching every memory is just Everything with a name on it, so the
Zod schema rejects it.

## Ownership

Every Space belongs to exactly one user. Three layers enforce it:

1. **Route** — each handler reads `req.userId` and never accepts a
   `userId` from the body.
2. **SQL** — every repository query filters on `spaces.user_id`
   (and `items.user_id` for membership).
3. **RLS** — policies on `spaces` / `space_items` from migration
   `018_spaces_v2_smart_rules.sql`.

Deleting a Space removes the Space, its memberships and its stored
rule. **Memories are never touched.**

## Colour

Seven curated, muted values, enforced by a `CHECK` constraint so a
client cannot inject `#ff00ff`:

`violet` · `blue` · `teal` · `sage` · `amber` · `rose` · `slate`

Colour is metadata only — it renders as a small dot or a left border
on a Space card, never as a saturated page background.

## Database invariants

Migration `018` adds two triggers:

* `space_items_require_manual_space` — refuses a membership row for
  a smart Space, so the rule stays the single source of truth.
* `spaces_touch_updated_at` — keeps `updated_at` honest without
  relying on every writer to remember.

`space_items` is `ON DELETE CASCADE` from `items`, so deleting a
memory drops its manual membership automatically. A smart Space
needs no cleanup at all: the next read simply stops matching.

## API

```
GET    /api/v1/spaces                 ?withCounts=1   live smart counts + previews
POST   /api/v1/spaces                                    manual or smart
POST   /api/v1/spaces/from-search                        smart, rule guaranteed
GET    /api/v1/spaces/:id
PATCH  /api/v1/spaces/:id                                 name / colour / rule
DELETE /api/v1/spaces/:id                                 memories survive
GET    /api/v1/spaces/:id/items                           manual: persisted | smart: computed
POST   /api/v1/spaces/:id/items        { itemIds[] }     manual only, idempotent
DELETE /api/v1/spaces/:id/items/:itemId                  membership only
```

Adding an item to a smart Space returns `422 SPACE_NOT_MANUAL`.
Duplicate ids are reported under `skipped`, not rejected.

## Web routes

* `/app/spaces` — All Spaces: name, MANUAL/SMART label, colour dot,
  live count, 3–4 real memory previews, last updated.
* `/app/spaces/:spaceId` — detail. Manual offers "Remove from
  Space"; smart offers "Edit Smart Space" and shows the criteria in
  plain words (never raw JSON).

## Components

Created: `SpacesPage`, `SpaceDetailPage`, `SpacePicker`,
`CreateSpaceDialog`, `SpaceIdentity` (`SpaceDot`, `SpaceColorPicker`,
`SpaceKindBadge`).

Reused: `MemoryCanvas` / `MemoryCard`, `DashboardShell`, the existing
search box and type/tag filters, the design tokens in `tokens.css`.

## Legacy

* `space_rules` table and `space_suggestions` table — dropped in 018.
* `apps/api/src/spaces/suggestions.ts` (AI clustering) — removed.
* Extension-local Spaces data — the dashboard now fetches
  `/api/v1/spaces`; no `SPACES_DATA` remains.

## Tests

| Suite | What it proves |
|-------|----------------|
| `packages/database/src/__tests__/spaces.test.ts` | CRUD, ownership isolation, idempotent add, smart rejection, delete preserves memories, dynamic smart membership |
| `apps/api/src/routes/__tests__/spaces.test.ts` | route contract: 28 cases |
| `apps/web/src/components/spaces/__tests__/spaces-components.test.tsx` | `SpacePicker`, `CreateSpaceDialog`, colour picker, rule summary |
| `apps/web/src/pages/__tests__/spaces-pages.test.tsx` | page render, save-as-space from an active search, multi-select, empty states |
| `apps/api/scripts/e2e-pipeline.mts` | scenarios A and B against a live API + database |
