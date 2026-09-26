/**
 * Item Management Routes
 *
 * CRUD operations for items.
 */

import express, { type Application, type Response, type Request } from 'express';
import type { Pool } from 'pg';
import type { ItemRepository } from '@mnemonics/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageStorage } from '../storage.js';

export interface ItemRouterDeps {
  pool: Pool;
  repository: ItemRepository;
  imageStorage?: ImageStorage;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
}

interface AuthedRequest extends Request {
  userId?: string;
  user?: { id: string; email?: string };
}

export function createItemRouter(deps: ItemRouterDeps): Application {
  const { pool, repository, imageStorage, supabase, expectedToken, developmentUserId } = deps;
  const router = express.Router() as Application;

  // Simple auth middleware
  const requireAuth = async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } });
        return;
      }

      const token = authHeader.slice(7);

      if (supabase) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
          return;
        }
        req.userId = user.id;
        req.user = user;
      } else {
        if (token !== (expectedToken || 'mnemonics-dev-token')) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
          return;
        }
        req.userId = developmentUserId || '00000000-0000-4000-8000-000000000001';
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/items - List items (the primary dashboard endpoint).
  // The response is wrapped in `{ data: { items, total, ... } }` to keep
  // the same envelope shape as every other endpoint under `/api/v1/`.
  // Each row is enriched with `kind` (= legacy `type`), `tags`, and a
  // signed `image_url` so the web dashboard and extension can render the
  // list without a follow-up `/items/:id` round-trip per row.
  router.get(
    '/items',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 100);
        const offset = parseInt(String(req.query.offset || '0'), 10);

        const result = await pool.query<Record<string, unknown>>(
          `SELECT id, type, title, source_url, raw_text, ocr_text,
                  status, client_request_id, captured_at, created_at, updated_at,
                  (SELECT storage_key FROM assets WHERE assets.item_id = items.id LIMIT 1) AS asset_storage_key
           FROM items
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        );

        const itemIds = result.rows.map((row) => String(row.id));
        const tagsByItem = new Map<string, string[]>();
        if (itemIds.length > 0) {
          const tagsResult = await pool.query<{ item_id: string; name: string }>(
            `SELECT it.item_id::text AS item_id, t.name
             FROM tags t
             JOIN item_tags it ON it.tag_id = t.id
             WHERE it.item_id = ANY($1::uuid[])
               AND t.user_id = $2`,
            [itemIds, userId]
          );
          for (const row of tagsResult.rows) {
            const list = tagsByItem.get(row.item_id) ?? [];
            list.push(row.name);
            tagsByItem.set(row.item_id, list);
          }
        }

        // Build a signed URL for each image so the renderer never has to
        // call the API per row. We use the same bucket as the upload
        // pipeline; if signing is unavailable the renderer falls back to
        // a storage-key-aware placeholder.
        async function signedUrlFor(storageKey: string | null): Promise<string | null> {
          if (!storageKey) return null;
          if (imageStorage) {
            return imageStorage.createSignedUrl(storageKey, 60 * 60).catch(() => null);
          }
          if (supabase) {
            try {
              const { data } = await supabase.storage.from('mnemonics-assets').createSignedUrl(storageKey, 60 * 60);
              return data?.signedUrl ?? null;
            } catch {
              return null;
            }
          }
          return null;
        }

        const items = await Promise.all(result.rows.map(async (row) => ({
          id: row.id,
          kind: row.type,
          title: row.title,
          source_url: row.source_url,
          raw_text: row.raw_text,
          ocr_text: row.ocr_text,
          status: row.status,
          client_request_id: row.client_request_id,
          captured_at: row.captured_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          tags: tagsByItem.get(String(row.id)) ?? [],
          image_url: await signedUrlFor(row.asset_storage_key as string | null)
        })));

        const total = await pool.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM items WHERE user_id = $1`,
          [userId]
        );

        res.json({
          data: {
            items,
            total: parseInt(total.rows[0].count, 10),
            limit,
            offset
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/items/:id - Get single item
  router.get(
    '/items/:id',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const item = await pool.query<Record<string, unknown>>(
          `SELECT * FROM items WHERE id = $1 AND user_id = $2`,
          [String(req.params.id), userId]
        );

        if (item.rows.length === 0) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        // Get tags for this item
        const tags = await pool.query<{ name: string }>(
          `SELECT t.name FROM tags t
           JOIN item_tags it ON it.tag_id = t.id
           WHERE it.item_id = $1`,
          [String(req.params.id)]
        );

        const result = item.rows[0];
        res.json({
          item: {
            ...result,
            tags: tags.rows.map(t => t.name)
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /api/v1/items/:id - Delete item
  router.delete(
    '/items/:id',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;

        // First get the item to check ownership and get storage key for cleanup
        const item = await repository.findById(String(req.params.id));
        if (!item) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        if (item.userId !== userId) {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this item' } });
          return;
        }

        // Delete in transaction
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Delete tag associations
          await client.query(
            `DELETE FROM item_tags WHERE item_id = $1`,
            [String(req.params.id)]
          );

          // Delete embeddings
          await client.query(
            `DELETE FROM item_embeddings WHERE item_id = $1`,
            [String(req.params.id)]
          );

          // Delete assets
          await client.query(
            `DELETE FROM assets WHERE item_id = $1`,
            [String(req.params.id)]
          );

          // Delete jobs
          await client.query(
            `DELETE FROM jobs WHERE item_id = $1`,
            [String(req.params.id)]
          );

          // Delete the item
          await client.query(
            `DELETE FROM items WHERE id = $1`,
            [String(req.params.id)]
          );

          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  // PATCH /api/v1/items/:id - Update item
  router.patch(
    '/items/:id',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const updates = req.body as { title?: string; notes?: string };

        const item = await repository.findById(String(req.params.id));
        if (!item) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        if (item.userId !== userId) {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this item' } });
          return;
        }

        const updateFields: string[] = [];
        const values: unknown[] = [];

        if (updates.title !== undefined) {
          updateFields.push(`title = $${values.length + 1}`);
          values.push(updates.title);
        }

        if (updates.notes !== undefined) {
          updateFields.push(`notes = $${values.length + 1}`);
          values.push(updates.notes);
        }

        if (updateFields.length === 0) {
          res.status(400).json({ error: { code: 'NO_UPDATES', message: 'No fields to update' } });
          return;
        }

        updateFields.push(`updated_at = NOW()`);
        values.push(String(req.params.id));

        await pool.query(
          `UPDATE items SET ${updateFields.join(', ')} WHERE id = $${values.length}`,
          values
        );

        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
