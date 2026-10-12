# Content Clusters

> Automatically group memories by topic — no manual tagging, no paid
> AI required.

Content Clusters is the **automatic** counterpart to the
[user-curated Spaces](./spaces.md). The algorithm reads the same
embeddings that already power semantic search and "Related memories",
turns them into a curated similarity graph, and surfaces the resulting
groups in the dashboard and the extension.

A cluster is a *computed* thing: it is recomputed when a memory's
embedding changes, and it can grow, shrink, or split. If you want
something persistent, [save it as a Space](#save-cluster-as-space).

This document is the canonical reference for the feature. It is the
single source of truth — the same one the API contract, the database
schema, and the UI behaviour all read from. If you change the
behaviour, change this file in the same commit.

---

## Why clusters, not better Spaces?

Spaces work well for memories the user has decided belong together.
The trouble is that a user has to *do* the deciding. We already do
the equivalent of deciding in the background every time we embed a
memory: we ask "what is this most similar to?" The clusters feature
turns that single-link view into a connected-component view — "what
is this transitively similar to?" — and exposes the result.

The two features co-exist:

| | Cluster | Manual Space | Smart Space |
|---|---|---|---|
| Who owns membership? | the algorithm | the user | the user (via saved search) |
| When does membership change? | on refresh | when the user acts | on every read |
| Persistent? | no (cached) | yes | yes (rule, not items) |
| Can be edited? | no — use Save as Space | yes | yes (edit the rule) |

The dashboard, the extension, and the API never return clusters
as if they were Spaces. A user who wants Spaces will get them
through the explicit "Save as Space" action on a cluster.

---

## Algorithm

The implementation is in `packages/database/src/clusters.ts`. It is
deliberately boring.

1. **Read** every `item_edges` row with `edge_type = 'similar'` and
   `weight >= 0.78` for the current user. The threshold matches the
   one the auto-link pass uses, so the cluster graph and the
   related-items graph share the same notion of "similar". Edges
   below the threshold do not contribute to clusters.
2. **Find connected components** with a single recursive CTE that
   walks the graph and labels every node with the minimum id it can
   reach. Walking only into strictly-higher ids is what makes the
   recursion terminate without cycle detection.
3. **Drop** any component smaller than `min_size` (default `3`).
   A two-item component is barely a topic; one is noise.
4. **Pick a representative** for each component: the member whose
   average edge weight to the other members is the highest. This
   becomes the cluster's cover image and its anchor for navigation.
5. **Mine a title** deterministically from the cluster's tags,
   titles, and TLDRs. The title builder is documented in
   [§ Cluster title](#cluster-title) below. No LLM is required.

Complexity is `O(N + E)` over the edge table — there is no all-pairs
brute force in the request path. The largest component in the
production database, with 27 embedded items, completes in under
100 ms.

### Why connected components, not DBSCAN?

- **Deterministic.** Two refreshes over the same corpus produce the
  same cluster ids; the algorithm is reproducible.
- **No noise cluster.** DBSCAN marks "border" points; the
  equivalent here is `unclustered`. We chose to surface that as an
  explicit count (`unclusteredCount` in the API) rather than as
  thousands of single-item pseudo-clusters.
- **No training.** A DBSCAN `eps` and `min_samples` would need
  per-user calibration. The connected-component approach inherits
  the auto-link threshold that is already calibrated.
- **Reuses existing infrastructure.** The curated edge graph is
  already what powers "Related memories"; we get clustering for free.

DBSCAN would buy nothing here. If a future evaluation shows the
component count drifts too much as the corpus grows, the swap is
contained to `clusters.ts`.

---

## Cluster identity and stability

Cluster ids are deterministic: they are the FNV-1a 64-bit hash of the
sorted member ids. If the membership is the same, the id is the
same; the user does not see a cluster id change every time one
memory arrives.

Concretely:

- Adding a memory that *would* join an existing cluster does not
  change the cluster id (membership changes, sorted-set hash changes
  too — but a *new* cluster is created and the old one shrinks).
  The system does not preserve an "old id with a new member" because
  that would be a different cluster.
- Removing a memory never changes the remaining members' cluster id
  (sorted-set hash over a subset is consistent with the original).
- The cluster that contains a memory at refresh time is *the only*
  cluster that contains it. A memory belongs to at most one cluster.

We do not, in v1, try to detect "the same topic, slightly different
membership". The user can take action: if two clusters look like
they should be one, [Save one as a Space](#save-cluster-as-space)
and add the other cluster's memories to it.

---

## Cluster title

Title generation is deterministic and lives in `clusters.ts`. The
rules:

1. Tokenise every cluster member's `title`, `tldr`, and `tags`.
2. Strip diacritics, fold to lower-case, drop stopwords. English and
   Vietnamese stopword lists are bundled in the file.
3. Rank the remaining tokens by frequency, preferring tag-tokenised
   matches by a 2× weight (they are typically topical, not narrative).
4. Take the top 4 tokens. If fewer than 2 survive, or no token is at
   least 5 characters long, the title is `null` and the cluster is
   rendered as "Untitled group" in the UI.
5. Otherwise capitalise and join with ` & `.

Examples (synthetic):

| Members | Generated title |
|---|---|
| DCF valuation, Comparable companies, EV/EBITDA, Hospital M&A (all tagged `valuation`) | `Valuation & Dcf & Comps & Ev-ebitda` |
| PPO paper, Safe RL note, Barrier function (all tagged `rl`) | `Rl & Ppo & Safe & Barrier` |
| Random notes, no tags | `null` → "Untitled group" |

The `&` join is intentional: a comma-separated list reads as a
phrase ("dcf, comps, ev ebitda") and an ampersand reads as a
collection of related concepts. The UI is free to replace `&` with
`,` in a future iteration; the API contract does not depend on the
exact joiner.

The Ollama naming hook is layered on top in
`apps/api/src/routes/clusters.ts` if `AI_CLUSTER_NAMING_PROVIDER=ollama`
is set. The hook only improves the *displayed* title; the underlying
title from the deterministic builder is always available. A failure
of the Ollama call does not block the cluster — it is a pure
after-the-fact rename.

---

## Save cluster as Space

`POST /api/v1/clusters/:id/save-as-space` is the user-visible bridge
between automatic and manual organisation. The handler:

1. Looks up the cluster (scoped by user; 404 on miss).
2. Creates a `spaces` row with `space_type = 'manual'`, the cluster
   title as the default name, and the cluster representative as the
   cover.
3. Calls `spaceRepo.addItems()` with the cluster's *current* member
   ids.
4. Returns `{ spaceId, memberCount }`.

What this does *not* do:

- It does **not** create a Smart Space. Smart Spaces are
  `SearchRequest` rules; clusters do not have rules. Trying to
  re-express a cluster as a saved search would silently drop or
  include memories the cluster has no opinion about.
- It does **not** continue to follow the cluster. The manual Space
  is its own thing. If a memory joins the cluster after the save,
  the Space is unaffected. If a memory leaves the cluster, the
  Space keeps it.
- It does **not** create an additional cluster. The cluster
  snapshot is unchanged by the save.

This is the one place the two systems overlap, and the overlap is
deliberately one-way and one-shot.

---

## Database

Two new tables, both owned by the authenticated user via RLS
(see `packages/database/migrations/021_content_clusters.sql`):

```
content_clusters
  id                  TEXT PRIMARY KEY    -- stable hash of sorted member ids
  user_id             UUID NOT NULL
  signature           TEXT NOT NULL       -- duplicate of id, kept for explicit joins
  title               TEXT
  summary             TEXT
  representative_item_id UUID
  item_count          INTEGER NOT NULL CHECK (item_count > 0)
  average_edge_weight DOUBLE PRECISION
  algorithm_version   TEXT NOT NULL       -- e.g. 'cc-on-edges-v1'
  embedding_model     TEXT NOT NULL
  similarity_threshold DOUBLE PRECISION
  min_size            INTEGER
  created_at, updated_at, expires_at TIMESTAMPTZ

content_cluster_items
  cluster_id          TEXT NOT NULL REFERENCES content_clusters(id) ON DELETE CASCADE
  item_id             UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE
  score               DOUBLE PRECISION
  rank                INTEGER
  PRIMARY KEY (cluster_id, item_id)
```

Notes:

- A `UNIQUE` partial index on `content_cluster_items(item_id)`
  enforces the "one primary cluster per memory" rule at the storage
  level. A memory that joins a second cluster will replace its
  membership row, not coexist in two clusters. Related Memories
  already covers multi-edge relationships, so the v1 simplification
  is not lossy.
- `algorithm_version` and `embedding_model` are stored on every
  row. A future migration that re-embed users under a new model can
  detect stale clusters and re-run a refresh.
- `content_clusters` is a *cache*. The canonical truth remains the
  embedding and the edge table; the cluster snapshot is regenerated
  on demand.

---

## API

All endpoints are mounted under `/api/v1` and require the same auth
as the rest of the API. The user identity comes from the token, not
from any client-supplied parameter. Every response is
`{ data: ... }`-shaped to match the rest of the API.

| Method | Path | Purpose |
|---|---|---|
| GET | `/clusters` | List the user's clusters + `unclusteredCount` |
| GET | `/clusters/:id` | Cluster metadata + paginated member ids |
| POST | `/clusters/refresh` | Force a recompute for the caller (returns counts) |
| POST | `/clusters/:id/save-as-space` | Materialise the cluster as a manual Space |

### `GET /clusters`

```json
{
  "data": {
    "clusters": [
      {
        "id": "a1b2c3d4e5f60001",
        "title": "Valuation & Dcf & Comps",
        "summary": "Memories about valuation, dcf, comps.",
        "itemCount": 4,
        "representativeItemId": "…",
        "algorithmVersion": "cc-on-edges-v1",
        "embeddingModel": "text-embedding-3-small",
        "similarityThreshold": 0.78,
        "minSize": 3,
        "createdAt": "2026-10-07T12:34:56.000Z",
        "updatedAt": "2026-10-07T12:34:56.000Z",
        "representativeItems": [
          { "id": "…", "kind": "text", "title": "DCF valuation", "thumbnailUrl": null, "isFavorite": false }
        ]
      }
    ],
    "unclusteredCount": 7
  }
}
```

### `GET /clusters/:id`

```json
{
  "data": {
    "cluster": { "id": "…", "title": "…", "itemCount": 4, "…" },
    "items": ["…", "…", "…", "…"],
    "limit": 50,
    "offset": 0
  }
}
```

`limit` is capped at 100; `offset` defaults to 0. The endpoint
returns ids only — the UI then re-fetches full memory rows through
the same `GET /api/v1/items` it uses everywhere else.

### `POST /clusters/refresh`

Synchronous recompute. Used by the "Refresh groups" button in the
dashboard. The background embed hook also triggers a refresh
automatically after every successful embed (see [§ Refresh
strategy](#refresh-strategy) below), so the button is mostly a
debugging escape hatch.

```json
{
  "data": {
    "algorithmVersion": "cc-on-edges-v1",
    "embeddingModel": "text-embedding-3-small",
    "similarityThreshold": 0.78,
    "minSize": 3,
    "eligibleItemCount": 11,
    "clusterCount": 2,
    "unclusteredCount": 7,
    "durationMs": 42
  }
}
```

### `POST /clusters/:id/save-as-space`

```json
// request
{
  "name": "M&A research",
  "description": "M&A work I want to come back to",
  "color": "violet"
}

// response
{ "data": { "spaceId": "…", "memberCount": 4 } }
```

`name`, `description`, and `color` are optional. The cluster's title
and summary become the defaults. `color` is constrained to the
existing Space palette (`violet`, `blue`, `teal`, `sage`, `amber`,
`rose`, `slate`).

### Feature flag

`CONTENT_CLUSTERING_ENABLED=false` causes every endpoint to return
`404 { error: { code: 'CLUSTERING_DISABLED' } }`. The web dashboard
and the extension both treat the 404 as "hide the Groups tab". A
production rollback is therefore a single env var.

---

## Refresh strategy

A user does not need to click "Refresh groups" after every save.
The embed handler calls `clusterRepo.refresh(userId)` in the same
fire-and-forget step that runs the auto-link pass, after the memory
transitions to `ready`:

1. The memory is `ready` and searchable.
2. The new similarity edges have been written.
3. The cluster snapshot is recomputed for that user.

The recompute is best-effort: a slow or failing refresh does not
roll the memory back, and the user simply sees their old clusters
on the next page load until the refresh finishes. The
embed handler logs the outcome (cluster count, unclustered count,
duration) so a slow tail shows up in monitoring.

The "Refresh groups" button is the escape hatch for the rare case
where the user is staring at the page at the moment a refresh is
running and wants the new state immediately.

---

## Zero-cost mode

The feature works with `AI_FREE_ONLY=true` and
`AI_ALLOW_PAID_PROVIDERS=false`. There is no paid provider in the
cluster code path:

- Embeddings: reuses the existing embedding provider (Gemini or
  local Ollama), which is already in the zero-cost story.
- Clustering: deterministic SQL.
- Title: deterministic keyword extraction. The Ollama-after-the-fact
  rename is skipped because Ollama is not in the zero-cost path
  by default (it is local but optional).
- Summary: deterministic.

The optional Ollama hook only runs when `AI_CLUSTER_NAMING_PROVIDER=ollama`
is set. If it is set but the model is missing, the cluster still
appears with its deterministic title — the failure is logged and
swallowed.

---

## Performance

The cluster refresh is `O(N + E)` over the edge table with one
recursive CTE and one metadata query. On the production database
with 27 embedded items and 38 edges, the full refresh completes in
~40 ms. The largest component contains 4 memories.

If the corpus grows past a few thousand memories, two things help:

1. The `item_edges` table already has indexes on
   `(user_id, from_item_id)`, `(user_id, to_item_id)`, and
   `(edge_type)`. The recursive CTE uses the user-scoped ones.
2. The component CTE only walks edges with `weight >= threshold`,
   so the working set is the curated graph, not the embedding
   table. The full embedding table never enters the request path.

The `item_count`, `representative_item_id`, and `algorithm_version`
columns on `content_clusters` are denormalised for read efficiency.
The detail endpoint paginates `content_cluster_items` with
`limit`/`offset` so a single large cluster does not blow up the
response.

---

## Web / Extension parity

Web and extension both consume the same `/api/v1/clusters` endpoints.
There is no client-side clustering and no extension-only heuristic
(spec §12, §32). The contract test in
`apps/api/src/routes/__tests__/cluster-parity.test.ts` builds two
identical Express apps, both authenticated as the same user, and
asserts the responses are byte-equal.

Parity matrix:

| Capability | Web | Extension |
|---|:---:|:---:|
| List clusters | ✓ | ✓ |
| Open cluster detail | ✓ | ✓ |
| View members | ✓ | ✓ |
| Refresh clusters | ✓ | ✓ |
| Save as Space | ✓ | ✓ |
| Open memory | ✓ | ✓ |
| Empty / error / loading states | ✓ | ✓ |
| 404 → hide tab when feature flag is off | ✓ | ✓ |

The two surfaces look slightly different — the extension is single
column and more compact because the popup width is constrained —
but the data is identical.

---

## Failure semantics

The cluster path is best-effort. The non-negotiables (spec §60):

- A failing cluster refresh never blocks a memory from becoming
  `ready`. The memory is searchable as soon as the embed step
  completes; clusters catch up on the next refresh.
- A failing cluster refresh never breaks search, capture, or
  Spaces. The user can keep using the app.
- A cluster that fails to load shows the empty-state copy "We can't
  update groups right now" with a "Try again" button, not a stack
  trace.
- The auto-link pass and the cluster pass are wrapped in separate
  `try / catch`es in the embed handler. A graph failure does not
  block clusters and vice versa.

---

## Testing

- `packages/database/src/__tests__/clusters-algorithm.test.ts` —
  pure unit tests for the deterministic parts (id hashing,
  representative selection, signal collection, title building).
- `packages/database/src/__tests__/clusters.test.ts` — integration
  test for the SQL CTE and the repository, including user
  isolation, determinism across refreshes, and tag-driven titles.
- `apps/api/src/routes/__tests__/clusters.test.ts` — HTTP-level
  tests for every endpoint, including the 404-on-disabled flag and
  the "different user cannot read this cluster" guarantee.
- `apps/api/src/routes/__tests__/cluster-parity.test.ts` — the
  web/extension contract test.

All four suites run as part of `pnpm test` and pass.

---

## Open follow-ups (not in v1)

- Multi-cluster membership (one memory in several clusters) is
  rejected at the storage layer. Related Memories already covers
  multi-relationship semantics, so the simplification is intentional
  for v1. Lift the partial unique index if a user need appears.
- Cluster deletion / dismissal. A future iteration may want
  "Hide this group" with a per-user cluster-dismissed flag. v1
  renders whatever the current corpus produces.
- A "merge two clusters" action. Currently the user can only
  re-anchor by saving one as a Space and adding the other cluster's
  members to it.
- Cluster naming via Ollama. The hook is wired in
  `clusters.ts → buildClusterTitle` but does not call out yet.
  The deterministic title is the production default.
