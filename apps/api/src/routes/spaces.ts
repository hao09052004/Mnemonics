/**
 * Spaces — REST API.
 *
 * Manual Spaces persist membership in `space_items`. Smart Spaces
 * persist *criteria* in `spaces.rule` and resolve through the shared
 * search service on every read, which is what makes them dynamic: a
 * memory captured after the Space was created matches the stored
 * criteria and appears with no write and no background job.
 *
 * Every route is scoped to `req.userId`. The repository repeats the
 * ownership check in SQL, and RLS enforces it underneath, so a
 * missing guard here cannot leak another user's memories.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  createSpaceRepository,
  hasMeaningfulCriteria,
  resolveSmartSpaceIds,
  SEARCH_KINDS,
  SPACE_COLORS,
  type SearchKind,
  type SearchRequest,
  type SpaceColor,
  type SpacePreviewItem,
  type SpaceType
} from '@mnemonics/database';
import {
  requireDevelopmentAuth,
  requireSupabaseAuth,
  type AuthenticatedRequest
} from '../auth.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '@mnemonics/ai';

export interface SpaceRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  embeddings?: EmbeddingProvider;
}

// Const tuples, so Zod's inferred type keeps the literal members
// instead of widening to `string[]`. The wider form would stop the
// parsed request from satisfying `SearchRequest.filters`.
const kindTuple = SEARCH_KINDS as unknown as [SearchKind, ...SearchKind[]];
const colorTuple = SPACE_COLORS as unknown as [string, ...string[]];

const colorSchema = z.enum(colorTuple);

const searchRequestSchema = z.object({
  q: z.string().max(512).optional().default(''),
  filters: z
    .object({
      tags: z.array(z.string().max(64)).max(20).optional(),
      kind: z.array(z.enum(kindTuple)).max(10).optional(),
      captured_after: z.string().datetime().optional(),
      captured_before: z.string().datetime().optional(),
      favorite: z.boolean().optional()
    })
    .optional()
});

/**
 * A Smart Space rule must carry at least one real constraint.
 * Without this, "Save as Space" on an unfiltered Everything view
 * would create a Space that matches every memory — a duplicate of the
 * main list with a name on it.
 */
const ruleSchema = searchRequestSchema.refine(
  (rule) => hasMeaningfulCriteria(rule as SearchRequest),
  { message: 'A smart Space needs at least a query, a type, a tag, a date range, or favourite-only' }
);

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    color: colorSchema.optional(),
    spaceType: z.enum(['manual', 'smart']),
    coverItemId: z.string().uuid().optional(),
    rule: ruleSchema.optional()
  })
  .refine(
    (v) =>
      (v.spaceType === 'smart' && v.rule !== undefined) ||
      (v.spaceType === 'manual' && v.rule === undefined),
    { message: 'rule is required for a smart Space and forbidden for a manual one' }
  );

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    color: colorSchema.nullable().optional(),
    coverItemId: z.string().uuid().nullable().optional(),
    rule: ruleSchema.optional()
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update'
  });

const addItemsBody = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(200)
});

/** Map a thrown repository error onto a status code. */
function failFromError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'SPACE_NOT_MANUAL') {
    res.status(422).json({
      error: {
        code: 'SPACE_NOT_MANUAL',
        message: 'A smart Space decides its own membership. Add the memory to a manual Space instead.'
      }
    });
    return;
  }
  if (message === 'SPACE_NOT_FOUND') {
    res.status(404).json({ error: { code: 'SPACE_NOT_FOUND', message: 'Space not found' } });
    return;
  }
  res.status(500).json({ error: { code: 'SPACE_ERROR', message } });
}

export function createSpaceRouter(deps: SpaceRouterDeps): Application {
  const {
    pool,
    supabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001',
    embeddings
  } = deps;
  const router = express.Router() as Application;
  const spaces = createSpaceRepository(pool);
  const requireAuth = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  /** Shared search dependency bag — the same object the search route uses. */
  const searchDeps = { pool, embeddings };

  /** Resolve a smart Space's current members. */
  async function resolveSmart(spaceId: string, userId: string, rule: SearchRequest) {
    return resolveSmartSpaceIds(searchDeps, userId, rule);
  }

  // ----- list -------------------------------------------------------

  // GET /api/v1/spaces
  //
  // `withCounts=1` resolves smart counts up front so the All Spaces
  // page can show a real number on every card. It is opt-in because
  // each smart Space costs one search; without the flag the page shows
  // "Auto" and the detail view fills it in.
  router.get('/spaces', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.userId!;
      const summaries = await spaces.listSpaces(userId);
      if (req.query.withCounts !== '1') {
        res.json({ data: { spaces: summaries } });
        return;
      }

      // Sequential rather than Promise.all: every smart Space hits the
      // same pgvector index, and unbounded parallelism would serialise
      // inside Postgres anyway while spiking the connection pool.
      const counts = new Map<string, number>();
      const livePreviews = new Map<string, Awaited<ReturnType<typeof tilesFor>>>();
      for (const space of summaries) {
        if (space.spaceType !== 'smart' || !space.rule) continue;
        const { ids } = await resolveSmart(space.id, userId, space.rule);
        counts.set(space.id, ids.length);
        livePreviews.set(space.id, await tilesFor(userId, ids));
      }

      // listSpaces only knows about persisted data, so it would clear
      // the smart previews we just computed. Re-apply them after.
      const enriched = summaries.map((s) => {
        const count = counts.get(s.id);
        return {
          ...s,
          itemCount: s.spaceType === 'manual' ? s.itemCount : count ?? null,
          previewItems: s.spaceType === 'smart' ? (livePreviews.get(s.id) ?? []) : s.previewItems
        };
      });
      res.json({ data: { spaces: enriched } });
    } catch (err) {
      next(err);
    }
  });

  // ----- create -----------------------------------------------------

  // POST /api/v1/spaces
  router.post('/spaces', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'INVALID_SPACE', message: 'Invalid space body', details: parsed.error.issues }
        });
        return;
      }
      const d = parsed.data;
      const space = await spaces.createSpace({
        userId: req.userId!,
        name: d.name,
        description: d.description ?? null,
        color: (d.color as SpaceColor) ?? null,
        spaceType: d.spaceType as SpaceType,
        coverItemId: d.coverItemId ?? null,
        rule: d.rule as SearchRequest | undefined
      });
      res.status(201).json({ data: { space } });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/spaces/from-search
   *
   * Convenience wrapper around POST /spaces. Same semantics; it exists
   * so the client cannot construct a mismatched { spaceType, rule }
   * pair by hand, which the Zod refine above would then reject.
   */
  router.post('/spaces/from-search', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = createBody.safeParse({ ...req.body, spaceType: 'smart' });
      if (!parsed.success || parsed.data.spaceType !== 'smart' || !parsed.data.rule) {
        res.status(400).json({
          error: { code: 'INVALID_SPACE', message: 'Invalid smart Space body', details: parsed.error?.issues }
        });
        return;
      }
      const d = parsed.data;
      const space = await spaces.createSpace({
        userId: req.userId!,
        name: d.name,
        description: d.description ?? null,
        color: (d.color as SpaceColor) ?? null,
        spaceType: 'smart',
        rule: d.rule as SearchRequest
      });
      res.status(201).json({ data: { space } });
    } catch (err) {
      next(err);
    }
  });

  // ----- read one ---------------------------------------------------

  // GET /api/v1/spaces/:id
  router.get('/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.userId!;
      const space = await spaces.getSpace(String(req.params.id), userId);
      if (!space) {
        res.status(404).json({ error: { code: 'SPACE_NOT_FOUND', message: 'Space not found' } });
        return;
      }

      let itemCount = space.itemCount;
      let previewItems = space.previewItems;
      if (space.spaceType === 'smart' && space.rule) {
        const { ids } = await resolveSmart(space.id, userId, space.rule);
        itemCount = ids.length;
        previewItems = await tilesFor(userId, ids);
      }

      res.json({ data: { space: { ...space, itemCount, previewItems } } });
    } catch (err) {
      next(err);
    }
  });

  // ----- update / delete -------------------------------------------

  // PATCH /api/v1/spaces/:id
  router.patch('/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = updateBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'INVALID_SPACE_UPDATE', message: 'Invalid update', details: parsed.error.issues }
        });
        return;
      }
      const updated = await spaces.updateSpace(String(req.params.id), req.userId!, {
        name: parsed.data.name,
        description: parsed.data.description,
        color: parsed.data.color as SpaceColor | null | undefined,
        coverItemId: parsed.data.coverItemId,
        rule: parsed.data.rule as SearchRequest | undefined
      });
      if (!updated) {
        res.status(404).json({ error: { code: 'SPACE_NOT_FOUND', message: 'Space not found' } });
        return;
      }
      res.json({ data: { space: updated } });
    } catch (err) {
      failFromError(res, err);
    }
  });

  // DELETE /api/v1/spaces/:id
  //
  // Removes the Space, its membership rows and its stored rule.
  // Memories are untouched: `space_items.item_id` is ON DELETE CASCADE
  // from the *membership*, and the item row itself is never touched.
  router.delete('/spaces/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const ok = await spaces.deleteSpace(String(req.params.id), req.userId!);
      if (!ok) {
        res.status(404).json({ error: { code: 'SPACE_NOT_FOUND', message: 'Space not found' } });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ----- members ----------------------------------------------------

  // GET /api/v1/spaces/:id/items
  //
  // Manual: persisted membership. Smart: the current match set, which
  // is recomputed from the stored rule on every call.
  router.get('/spaces/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const userId = req.userId!;
      const space = await spaces.getSpace(String(req.params.id), userId);
      if (!space) {
        res.status(404).json({ error: { code: 'SPACE_NOT_FOUND', message: 'Space not found' } });
        return;
      }

      if (space.spaceType === 'manual') {
        const ids = await spaces.listItems(space.id, userId, 200);
        return void res.json({ data: { ids, items: await tilesFor(userId, ids), source: 'manual' } });
      }

      if (!space.rule) {
        return void res.json({ data: { ids: [], items: [], source: 'smart' } });
      }
      const { ids, total } = await resolveSmart(space.id, userId, space.rule);
      res.json({ data: { ids, items: await tilesFor(userId, ids), total, source: 'smart' } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/spaces/:id/items — add many memories at once.
  //
  // Idempotent: an id that is already a member is reported back under
  // `skipped` instead of erroring, so a double-click cannot fail.
  router.post('/spaces/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = addItemsBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'INVALID_ITEMS', message: 'itemIds must be a non-empty array of uuids' }
        });
        return;
      }
      const result = await spaces.addItems(String(req.params.id), parsed.data.itemIds, req.userId!);
      res.status(200).json({ data: result });
    } catch (err) {
      failFromError(res, err);
    }
  });

  // DELETE /api/v1/spaces/:id/items/:itemId — membership only.
  // The memory itself survives; the user just drops it from this group.
  router.delete('/spaces/:id/items/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const ok = await spaces.removeItem(
        String(req.params.id),
        String(req.params.itemId),
        req.userId!
      );
      if (!ok) {
        res.status(404).json({ error: { code: 'NOT_IN_SPACE', message: 'Item is not in this Space' } });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;

  // ----- helpers ----------------------------------------------------

  /**
   * Lightweight tiles for a set of item ids: the minimum a memory
   * card or a Space preview needs. Deliberately no `raw_text` beyond a
   * 240-char excerpt, no `ocr_text`, and never image bytes — a Space
   * card must not drag whole documents into the All-Spaces response.
   *
   * `thumbnailUrl` is left null: assets live in a private bucket and
   * the client already resolves them through the signed-asset
   * endpoint, so minting a URL here would need a key this layer does
   * not hold. A null thumbnail makes the card fall back to a type
   * glyph.
   */
  async function tilesFor(userId: string, ids: string[]): Promise<SpacePreviewItem[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids)).slice(0, 60);
    const result = await pool.query<{
      id: string;
      type: string;
      title: string;
      is_favorite: boolean;
    }>(
      `SELECT i.id, i.type, i.title, i.is_favorite
       FROM items i
       WHERE i.user_id = $1 AND i.id = ANY($2::uuid[])`,
      [userId, unique]
    );
    // Preserve the caller's order: for a Smart Space it is the search
    // ranking, and re-sorting by id would throw that away.
    const order = new Map(unique.map((id, index) => [id, index]));
    return result.rows
      .map((row) => ({
        id: String(row.id),
        kind: String(row.type),
        title: String(row.title ?? ''),
        thumbnailUrl: null,
        isFavorite: Boolean(row.is_favorite)
      }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
}
