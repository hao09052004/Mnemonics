/**
 * GET /api/v1/items/:id/classification (spec 0005 §5.7).
 *
 * Returns the classification row for a captured item. The row
 * may have any `status` (`pending`/`processing`/`ready`/
 * `failed`/`skipped`); the caller decides how to display each
 * state. The web dashboard polls this endpoint when the
 * classification status is non-terminal.
 *
 * Behaviour:
 *   200 — returns the row wrapped in `{ data }`.
 *   404 — item missing OR item belongs to a different user
 *     (we don't distinguish, to avoid leaking item existence).
 *   503 — no Postgres pool (should never happen in prod).
 */
import express from 'express';
import type { Pool } from 'pg';
import { createItemRepository, createClassificationRepository } from '@mnemonics/database';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClassificationRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
}

export function createClassificationRouter(deps: ClassificationRouterDeps): express.Router {
  const { pool, supabase, expectedToken = 'mnemonics-dev-token', developmentUserId = '00000000-0000-4000-8000-000000000001' } = deps;
  const router = express.Router();
  const authMiddleware = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  router.get(
    '/items/:id/classification',
    authMiddleware,
    async (
      req: AuthenticatedRequest & { params: { id: string } },
      res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }
    ) => {
      const { id } = req.params;
      const items = createItemRepository(pool);
      const item = await items.findById(id);
      if (!item || item.userId !== req.userId) {
        res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
        return;
      }
      const classifications = createClassificationRepository(pool);
      const row = await classifications.findByItemId(id, req.userId);
      if (!row) {
        res.status(404).json({ error: { code: 'CLASSIFICATION_NOT_READY', message: 'No classification yet' } });
        return;
      }
      res.json({ data: row });
    }
  );

  return router;
}
