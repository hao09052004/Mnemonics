/**
 * Graph Routes
 *
 * Knowledge graph endpoints for related items and links.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';

export interface GraphRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
}

const edgeTypes = ['similar', 'references', 'related', 'duplicate', 'parent', 'child'] as const;
type EdgeType = typeof edgeTypes[number];

const createEdgeSchema = z.object({
  to_item_id: z.string().uuid(),
  edge_type: z.enum(edgeTypes),
  weight: z.number().min(0).max(1).optional().default(1),
  attributes: z.record(z.unknown()).optional().default({})
});

const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

export function createGraphRouter(deps: GraphRouterDeps): Application {
  const {
    pool,
    supabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001'
  } = deps;
  const router = express.Router() as Application;

  const requireAuth = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  // POST /api/v1/items/:id/edges - Create an edge
  router.post(
    '/items/:id/edges',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const fromItemId = String(req.params.id);

        const parsed = createEdgeSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_EDGE', message: 'Invalid edge data', details: parsed.error.issues } });
          return;
        }

        const edge = parsed.data;

        // Verify both items belong to user
        const ownershipCheck = await pool.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM items
           WHERE id IN ($1, $2) AND user_id = $3`,
          [fromItemId, edge.to_item_id, userId]
        );

        if (parseInt(ownershipCheck.rows[0].count, 10) !== 2) {
          res.status(404).json({ error: { code: 'ITEMS_NOT_FOUND', message: 'One or both items not found' } });
          return;
        }

        const result = await pool.query<Record<string, unknown>>(
          `INSERT INTO item_edges (user_id, from_item_id, to_item_id, edge_type, weight, attributes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, from_item_id, to_item_id, edge_type)
           DO UPDATE SET weight = EXCLUDED.weight, attributes = EXCLUDED.attributes
           RETURNING *`,
          [userId, fromItemId, edge.to_item_id, edge.edge_type, edge.weight, JSON.stringify(edge.attributes)]
        );

        res.status(201).json({ data: result.rows[0] });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/items/:id/edges - Get edges for an item
  router.get(
    '/items/:id/edges',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const itemId = String(req.params.id);

        const outgoing = await pool.query<Record<string, unknown>>(
          `SELECT * FROM item_edges
           WHERE from_item_id = $1 AND user_id = $2
           ORDER BY weight DESC`,
          [itemId, userId]
        );

        const incoming = await pool.query<Record<string, unknown>>(
          `SELECT * FROM item_edges
           WHERE to_item_id = $1 AND user_id = $2
           ORDER BY weight DESC`,
          [itemId, userId]
        );

        res.json({
          outgoing: outgoing.rows,
          incoming: incoming.rows,
          total: outgoing.rows.length + incoming.rows.length
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/items/:id/related - Get related items via embeddings
  router.get(
    '/items/:id/related',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const itemId = String(req.params.id);
        const parsedQuery = relatedQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          res.status(400).json({ error: { code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 50' } });
          return;
        }
        const limit = parsedQuery.data.limit;

        const source = await pool.query<{ id: string }>(
          `SELECT id FROM items WHERE id = $1 AND user_id = $2`,
          [itemId, userId]
        );

        if (source.rowCount === 0) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        const result = await pool.query<Record<string, unknown>>(
          `SELECT
            i.id, i.type, i.title, i.captured_at,
            1 - (ie1.embedding <=> ie2.embedding) AS similarity
          FROM item_embeddings ie1
          JOIN item_embeddings ie2 ON ie1.item_id != ie2.item_id
          JOIN items i ON i.id = ie2.item_id AND i.user_id = $2
          JOIN items source_item ON source_item.id = ie1.item_id AND source_item.user_id = $2
          WHERE ie1.item_id = $1
          ORDER BY ie1.embedding <=> ie2.embedding
          LIMIT $3`,
          [itemId, userId, limit]
        );

        res.json({
          related_items: result.rows.map(row => ({
            id: row.id,
            type: row.type,
            title: row.title,
            captured_at: row.captured_at,
            similarity: parseFloat(String(row.similarity))
          }))
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /api/v1/edges/:id - Delete an edge
  router.delete(
    '/edges/:id',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const edgeId = String(req.params.id);

        const result = await pool.query(
          `DELETE FROM item_edges WHERE id = $1 AND user_id = $2`,
          [edgeId, userId]
        );

        if (result.rowCount === 0) {
          res.status(404).json({ error: { code: 'EDGE_NOT_FOUND', message: 'Edge not found' } });
          return;
        }

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/graph/stats - Graph statistics
  router.get(
    '/graph/stats',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;

        const stats = await pool.query<Record<string, unknown>>(
          `SELECT
            COUNT(*) as total_edges,
            COUNT(DISTINCT from_item_id) as connected_from_count,
            COUNT(DISTINCT to_item_id) as connected_to_count,
            COUNT(DISTINCT edge_type) as edge_type_count
           FROM item_edges WHERE user_id = $1`,
          [userId]
        );

        const byType = await pool.query<Record<string, unknown>>(
          `SELECT edge_type, COUNT(*) as count
           FROM item_edges WHERE user_id = $1
           GROUP BY edge_type
           ORDER BY count DESC`,
          [userId]
        );

        res.json({
          stats: {
            total_edges: parseInt(String(stats.rows[0].total_edges || 0), 10),
            connected_from_count: parseInt(String(stats.rows[0].connected_from_count || 0), 10),
            connected_to_count: parseInt(String(stats.rows[0].connected_to_count || 0), 10),
            edge_type_count: parseInt(String(stats.rows[0].edge_type_count || 0), 10)
          },
          edges_by_type: byType.rows.map(row => ({
            type: row.edge_type,
            count: parseInt(String(row.count), 10)
          }))
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
