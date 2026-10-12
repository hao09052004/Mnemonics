/**
 * Content Clusters Routes
 *
 * Read-only API over the cluster snapshot produced by
 * `ClusterRepository.refresh()`. The repository is the only thing
 * that ever talks to the `content_clusters` tables; this file is
 * transport: auth, response shaping, and the manual "Refresh now"
 * action.
 *
 * Endpoints:
 *   GET  /api/v1/clusters               — list user's clusters
 *   GET  /api/v1/clusters/:id           — single cluster detail + members
 *   POST /api/v1/clusters/refresh       — synchronously recompute for caller
 *   POST /api/v1/clusters/:id/save-as-space — materialise a cluster into a
 *                                              manual Space (spec §31)
 *
 * The refresh path is the user-facing "Refresh groups" button. The
 * background job handler (`apps/api/src/jobs/handlers/cluster-refresh.ts`)
 * is what the embed-time hook enqueues, and it shares the same
 * repository method.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';
import {
  createClusterRepository,
  createSpaceRepository,
  CLUSTER_DETAIL_PAGE_SIZE,
  type ClusterConfig
} from '@mnemonics/database';

export interface ClusterRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  /** Optional override for the cluster algorithm. Tests use this. */
  config?: Partial<ClusterConfig>;
}

const DISABLED_RESPONSE = {
  error: {
    code: 'CLUSTERING_DISABLED',
    message: 'Content clusters are disabled'
  }
};

function isEnabled(): boolean {
  // Default ON. Set CONTENT_CLUSTERING_ENABLED=false to turn the
  // feature off everywhere; the route returns a 404 so the UI can
  // hide the controls.
  const flag = process.env.CONTENT_CLUSTERING_ENABLED;
  return flag !== 'false';
}

/**
 * Resolve the cluster algorithm config from environment variables.
 *
 * The defaults match the auto-link pass (`auto-link-similar.ts`) so
 * the cluster graph and the related-items graph share the same
 * notion of "similar". Override via env only when the corpus
 * needs it — changing the threshold in production changes every
 * cluster id, so a migration step is required first.
 */
function resolveClusterConfig(): Partial<ClusterConfig> {
  const cfg: Partial<ClusterConfig> = {};
  if (process.env.CONTENT_CLUSTER_MIN_SIZE) {
    const n = Number(process.env.CONTENT_CLUSTER_MIN_SIZE);
    if (Number.isFinite(n) && n > 0) cfg.minSize = Math.floor(n);
  }
  if (process.env.CONTENT_CLUSTER_SIMILARITY_THRESHOLD) {
    const v = Number(process.env.CONTENT_CLUSTER_SIMILARITY_THRESHOLD);
    if (Number.isFinite(v) && v > 0 && v <= 1) {
      cfg.similarityThreshold = v;
    }
  }
  return cfg;
}

export function createClusterRouter(deps: ClusterRouterDeps): Application {
  const {
    pool,
    supabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001',
    config
  } = deps;
  const router = express.Router() as Application;
  const requireAuth = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);
  const clusterRepo = createClusterRepository();
  const spaceRepo = createSpaceRepository(pool);
  // Caller-provided config takes precedence over env, env over
  // default. Tests pass an explicit override; production reads env.
  const resolvedConfig: Partial<ClusterConfig> = {
    ...resolveClusterConfig(),
    ...(config ?? {})
  };

  // GET /api/v1/clusters — list overview
  router.get('/clusters', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!isEnabled()) {
        res.status(404).json(DISABLED_RESPONSE);
        return;
      }
      const clusters = await clusterRepo.list(req.userId!, pool);
      res.json({
        data: {
          clusters: clusters.map((c) => ({
            id: c.id,
            title: c.title,
            summary: c.summary,
            itemCount: c.itemCount,
            representativeItemId: c.representativeItemId,
            algorithmVersion: c.algorithmVersion,
            embeddingModel: c.embeddingModel,
            similarityThreshold: c.similarityThreshold,
            minSize: c.minSize,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            representativeItems: c.previewItems.map((p) => ({
              id: p.id,
              kind: p.kind,
              title: p.title,
              thumbnailUrl: p.thumbnailUrl,
              isFavorite: p.isFavorite
            }))
          })),
          unclusteredCount: await countUnclustered(pool, req.userId!)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/clusters/:id — single cluster + paginated items
  router.get('/clusters/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!isEnabled()) {
        res.status(404).json(DISABLED_RESPONSE);
        return;
      }
      const cluster = await clusterRepo.get(String(req.params.id), req.userId!, pool);
      if (!cluster) {
        res.status(404).json({
          error: { code: 'CLUSTER_NOT_FOUND', message: 'Cluster not found' }
        });
        return;
      }
      const limitQuery = z.coerce.number().int().min(1).max(100).optional().default(CLUSTER_DETAIL_PAGE_SIZE);
      const offsetQuery = z.coerce.number().int().min(0).optional().default(0);
      const limitParsed = limitQuery.safeParse(req.query.limit);
      const offsetParsed = offsetQuery.safeParse(req.query.offset);
      const limit = limitParsed.success ? limitParsed.data : CLUSTER_DETAIL_PAGE_SIZE;
      const offset = offsetParsed.success ? offsetParsed.data : 0;
      // Milestone 2: return hydrated items so the detail page does
      // not have to intersect a global `items` list (which would
      // silently drop members beyond the dashboard page size).
      let items;
      try {
        items = await clusterRepo.listItemSummaries(
          cluster.id,
          req.userId!,
          pool,
          limit,
          offset
        );
      } catch (sqlErr) {
        // Surface the SQL error in test logs. The default error
        // handler swallows it and returns 500 with an empty body,
        // which makes test failures impossible to diagnose.
        // eslint-disable-next-line no-console
        console.error('[clusters/:id] listItemSummaries failed:', sqlErr);
        throw sqlErr;
      }

      res.json({
        data: {
          cluster: {
            id: cluster.id,
            title: cluster.title,
            summary: cluster.summary,
            itemCount: cluster.itemCount,
            representativeItemId: cluster.representativeItemId,
            algorithmVersion: cluster.algorithmVersion,
            embeddingModel: cluster.embeddingModel,
            similarityThreshold: cluster.similarityThreshold,
            minSize: cluster.minSize,
            createdAt: cluster.createdAt.toISOString(),
            updatedAt: cluster.updatedAt.toISOString()
          },
          items: items.map((it) => ({
            id: it.id,
            kind: it.kind,
            title: it.title,
            thumbnailUrl: it.thumbnailUrl,
            sourceUrl: it.sourceUrl,
            capturedAt: it.capturedAt.toISOString(),
            isFavorite: it.isFavorite,
            rank: it.rank
          })),
          limit,
          offset
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/clusters/refresh — synchronously recompute
  router.post('/clusters/refresh', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      if (!isEnabled()) {
        res.status(404).json(DISABLED_RESPONSE);
        return;
      }
      const result = await clusterRepo.refresh(req.userId!, { pool, config: resolvedConfig });
      res.json({
        data: {
          algorithmVersion: result.algorithmVersion,
          embeddingModel: result.embeddingModel,
          similarityThreshold: result.similarityThreshold,
          minSize: result.minSize,
          eligibleItemCount: result.eligibleItemCount,
          clusterCount: result.clusterCount,
          unclusteredCount: result.unclusteredCount,
          durationMs: result.durationMs
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/clusters/:id/save-as-space — materialise as a manual Space
  const saveAsSpaceBody = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    color: z
      .enum(['violet', 'blue', 'teal', 'sage', 'amber', 'rose', 'slate'])
      .optional()
  });

  router.post(
    '/clusters/:id/save-as-space',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response, next) => {
      try {
        if (!isEnabled()) {
          res.status(404).json(DISABLED_RESPONSE);
          return;
        }
        const parsed = saveAsSpaceBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({
            error: {
              code: 'INVALID_SAVE_AS_SPACE_BODY',
              message: 'Invalid save-as-space request',
              details: parsed.error.issues
            }
          });
          return;
        }
        const cluster = await clusterRepo.get(String(req.params.id), req.userId!, pool);
        if (!cluster) {
          res.status(404).json({
            error: { code: 'CLUSTER_NOT_FOUND', message: 'Cluster not found' }
          });
          return;
        }
        const memberIds = await clusterRepo.listItemIds(cluster.id, req.userId!, pool, 1000, 0);
        if (memberIds.length === 0) {
          res.status(422).json({
            error: {
              code: 'EMPTY_CLUSTER',
              message: 'Cluster has no members to save'
            }
          });
          return;
        }
        const space = await spaceRepo.createSpace({
          userId: req.userId!,
          name: parsed.data.name ?? cluster.title ?? 'Untitled group',
          description: parsed.data.description ?? cluster.summary ?? null,
          color: parsed.data.color ?? 'violet',
          spaceType: 'manual',
          coverItemId: cluster.representativeItemId
        });
        await spaceRepo.addItems(space.id, memberIds, req.userId!);
        res.status(201).json({
          data: { spaceId: space.id, memberCount: memberIds.length }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

async function countUnclustered(pool: Pool, userId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT (
        (SELECT COUNT(*)::int FROM items i WHERE i.user_id = $1 AND i.status = 'ready')
        -
        (SELECT COUNT(DISTINCT cci.item_id)::int
           FROM content_cluster_items cci
           JOIN content_clusters cc ON cc.id = cci.cluster_id
          WHERE cc.user_id = $1)
      )::int AS n`,
    [userId]
  );
  return Number(result.rows[0]?.n ?? 0);
}
