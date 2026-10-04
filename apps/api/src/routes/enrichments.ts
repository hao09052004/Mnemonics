/**
 * Memory Understanding routes.
 *
 * Read-side: GET enrichment (caption, tldr, summary) for a single
 * item. Write-side: PATCH the user-editable TLDR with provenance
 * tracking. Manual TLDR is protected from auto-overwrite (see
 * `EnrichmentRepository.setUserTldr`).
 */

import express, { type Application, type Response } from 'express';
import { z } from 'zod';
import { createEnrichmentRepository, type ItemEnrichment } from '@mnemonics/database';
import {
  requireDevelopmentAuth,
  requireSupabaseAuth,
  type AuthenticatedRequest
} from '../auth.js';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobQueue } from '../jobs/queue.js';
import type { AiService } from '@mnemonics/ai';

export interface EnrichmentRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  queue?: JobQueue;
}

const tldrBody = z.object({
  tldr: z.string().min(1).max(240),
  regenerate: z.boolean().optional()
});

export function createEnrichmentRouter(deps: EnrichmentRouterDeps): Application {
  const {
    pool,
    supabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001',
    queue
  } = deps;
  const router = express.Router() as Application;
  const enrichments = createEnrichmentRepository(pool);
  const requireAuth = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  // GET /api/v1/items/:id/enrichment
  router.get('/items/:id/enrichment', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const itemId = String(req.params.id);
      const itemRow = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM items WHERE id = $1`,
        [itemId]
      );
      const row = itemRow.rows[0];
      if (!row || row.user_id !== req.userId) {
        res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
        return;
      }
      const enrichment = await enrichments.getForItem(itemId);
      res.json({ data: { enrichment: enrichment ?? null } });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/items/:id/tldr — user-edit or regenerate.
  router.patch('/items/:id/tldr', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const itemId = String(req.params.id);
      const parsed = tldrBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_TLDR', message: 'Invalid TLDR body' } });
        return;
      }
      const itemRow = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM items WHERE id = $1`,
        [itemId]
      );
      const row = itemRow.rows[0];
      if (!row || row.user_id !== req.userId) {
        res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
        return;
      }
      await enrichments.ensureRow(itemId, req.userId!);
      if (parsed.data.regenerate && queue) {
        // Mark tldr as pending so the worker re-runs.
        await pool.query(
          `UPDATE item_enrichments
             SET tldr_status = 'pending', tldr_error_code = NULL
           WHERE item_id = $1`,
          [itemId]
        );
        await queue.create({
          type: 'enrich' as 'embed',
          itemId,
          userId: req.userId!,
          payload: { force: true }
        });
        res.json({ data: { ok: true, regenerating: true } });
        return;
      }
      await enrichments.setUserTldr(itemId, req.userId!, parsed.data.tldr);
      const updated = await enrichments.getForItem(itemId);
      res.json({ data: { enrichment: updated } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export type EnrichmentResponse = ItemEnrichment | null;