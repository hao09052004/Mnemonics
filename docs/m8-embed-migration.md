# M8 — Embedding-model migration

## Why

M1–M7 hard-coded the embedding model to
`bge-m3-or-gemini` (or whatever the env var was set to)
for every user. M8 introduces a path to change the model
for one user without nuking the table.

The path is small: a SQL function that counts the items
that need to be re-embedded, plus a payload contract on
the embed handler so the same handler can be re-driven
with a different model.

## What

A new SQL function `re_embed_user(user_id, target_model)
→ integer` returns the count of `ready` items for a
user whose current `embedding_model` differs from the
target. The function is **count-only**; it does not
write to the `jobs` table.

The `EmbedHandler` now reads
`job.payload.targetEmbeddingModel`. When present, the
handler uses that model for the embedding call and
sets the row's `embedding_model` to match. When
absent, the env-driven default (M1 contract) is
preserved.

A new migration `024_embedding_model_migration.sql`
adds the function and a partial index on
`(item_id, model)`.

## How to roll a user from one model to another

1. Run the count:
   ```sql
   SELECT re_embed_user(
     '00000000-0000-4000-8000-000000000001'::uuid,
     'gemini-embedding-002'
   );
   ```
2. Enqueue one `embed` job per item with
   `targetEmbeddingModel: 'gemini-embedding-002'` in
   the payload.
3. The handler re-embeds each item with the new model
   and writes the row's `embedding_model` accordingly.
4. Verify the migration with:
   ```sql
   SELECT re_embed_user(
     '00000000-0000-4000-8000-000000000001'::uuid,
     'gemini-embedding-002'
   );
   ```
   The second call must return `0`.

The orchestration in steps 2 and 3 is a deployment
runbook, not in M8. M8 ships the function and the
handler; the runbook is a separate change.

## Where

- `packages/database/migrations/024_embedding_model_migration.sql`
  — the function and the partial index.
- `apps/api/src/jobs/re-embed-user.ts` — the JS-side
  count helper.
- `apps/api/src/jobs/handlers/embed.ts` — the
  `targetEmbeddingModel` payload contract.

## Out of scope

- The orchestration script that calls
  `re_embed_user` and enqueues one job per item.
- Chunk embeddings. A separate
  `re_embed_user_chunks` function is a future change.
- A UI to "switch model".
- Automatic cron re-embed.
- A/B evaluation across models.
