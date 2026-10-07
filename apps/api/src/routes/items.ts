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
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  imageStorage?: ImageStorage;
}

interface AuthedRequest extends Request {
  userId?: string;
  user?: { id: string; email?: string };
}

export function createItemRouter(deps: ItemRouterDeps): Application {
  const { pool, repository, supabase, expectedToken, developmentUserId, imageStorage } = deps;
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
        const favoritesOnly = String(req.query.favorite || '') === 'true';

        const result = await pool.query<Record<string, unknown>>(
          `SELECT id, type, title, source_url, raw_text, ocr_text,
                  status, client_request_id, captured_at, created_at, updated_at,
                  is_favorite, page_count,
                  (SELECT storage_key FROM assets WHERE assets.item_id = items.id LIMIT 1) AS asset_storage_key
           FROM items
           WHERE user_id = $1
             AND ($4::boolean = false OR is_favorite = true)
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset, favoritesOnly]
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
        // call the API per row. If signing fails we try the public URL
        // path (works when the bucket is configured public) and only
        // fall back to a placeholder when neither is available.
        async function signedUrlFor(storageKey: string | null): Promise<string | null> {
          if (!storageKey) return null;
          if (!supabase && !imageStorage) return null;
          if (imageStorage && typeof imageStorage.createSignedUrl === 'function') {
            try {
              const signed = await imageStorage.createSignedUrl(storageKey, 60 * 60);
              if (signed) return signed;
            } catch {
              // fall through to public URL
            }
          }
          if (imageStorage && typeof imageStorage.createPublicUrl === 'function') {
            try {
              const publicUrl = await imageStorage.createPublicUrl(storageKey);
              if (publicUrl) return publicUrl;
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
          is_favorite: row.is_favorite === true,
          page_count: row.page_count ?? null,
          tags: tagsByItem.get(String(row.id)) ?? [],
          image_url: await signedUrlFor(row.asset_storage_key as string | null)
        })));

        const total = await pool.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM items
           WHERE user_id = $1 AND ($2::boolean = false OR is_favorite = true)`,
          [userId, favoritesOnly]
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
          `SELECT id, type, title, source_url, raw_text, ocr_text,
                  status, client_request_id, captured_at, created_at, updated_at,
                  is_favorite, page_count, ocr_engine, ocr_language, ocr_confidence,
                  ocr_processed_at, ocr_error_code
             FROM items WHERE id = $1 AND user_id = $2`,
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

        // Pull the asset row (storage key + mime + filename) so the
        // dashboard can render the original-document actions
        // (open/download) for document memories without a second
        // round-trip.
        const assetRow = await pool.query<Record<string, unknown>>(
          `SELECT storage_key, mime_type, size_bytes, original_filename
             FROM assets WHERE item_id = $1
             ORDER BY created_at DESC LIMIT 1`,
          [String(req.params.id)]
        );
        const assetResult = assetRow.rows[0] ?? null;
        let signedUrl: string | null = null;
        if (
          assetResult?.storage_key &&
          imageStorage &&
          typeof imageStorage.createSignedUrl === 'function'
        ) {
          try {
            signedUrl = await imageStorage.createSignedUrl(
              String(assetResult.storage_key),
              60 * 60
            );
          } catch {
            signedUrl = null;
          }
        }

        const result = item.rows[0];
        res.json({
          item: {
            ...result,
            tags: tags.rows.map((t) => t.name),
            ...(assetResult
              ? {
                  asset: {
                    mime_type: assetResult.mime_type ?? null,
                    size_bytes: assetResult.size_bytes ?? null,
                    original_filename: assetResult.original_filename ?? null
                  }
                }
              : {}),
            signed_url: signedUrl
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
        const itemId = String(req.params.id);

        // First get the item to check ownership and get storage key for cleanup
        const item = await repository.findById(itemId);
        if (!item) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        if (item.userId !== userId) {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this item' } });
          return;
        }

        // Collect every storage key attached to this item BEFORE we
        // wipe the asset rows — we have to clean the Supabase Storage
        // objects too, otherwise deleting a memory leaves orphan files
        // in the bucket (and costs storage forever).
        const assetRows = await pool.query<{ storage_key: string }>(
          `SELECT storage_key FROM assets WHERE item_id = $1`,
          [itemId]
        );
        const storageKeys = assetRows.rows.map((row) => row.storage_key);

        // Delete in transaction
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Delete tag associations
          await client.query(
            `DELETE FROM item_tags WHERE item_id = $1`,
            [itemId]
          );

          // Delete embeddings
          await client.query(
            `DELETE FROM item_embeddings WHERE item_id = $1`,
            [itemId]
          );

          // Delete assets
          await client.query(
            `DELETE FROM assets WHERE item_id = $1`,
            [itemId]
          );

          // Delete jobs
          await client.query(
            `DELETE FROM jobs WHERE item_id = $1`,
            [itemId]
          );

          // Delete the item
          await client.query(
            `DELETE FROM items WHERE id = $1`,
            [itemId]
          );

          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        // Best-effort storage cleanup, *after* the DB commit so a
        // failure here doesn't leave the row pointing at a removed
        // file. We log but don't fail the request — the user-visible
        // outcome is "the memory is gone", and an orphan file is far
        // cheaper to clean up later than a stuck delete.
        if (imageStorage && storageKeys.length > 0) {
          await Promise.all(
            storageKeys.map((storageKey) =>
              imageStorage.remove(storageKey).catch((err: unknown) => {
                // eslint-disable-next-line no-console
                console.warn(
                  `[items.delete] failed to remove storage object ${storageKey}:`,
                  err
                );
              })
            )
          );
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
        const itemId = String(req.params.id);
        const updates = req.body as {
          title?: string;
          notes?: string;
          isFavorite?: boolean;
          tags?: string[];
        };

        // Temporary diagnostic: confirm the route actually received
        // `tags` in the body so the "No fields to update" mystery is
        // easier to triage from the dev-server log.
        console.log('[PATCH /items/:id]', {
          itemId,
          keys: Object.keys(updates || {}),
          tags: Array.isArray(updates && updates.tags) ? updates.tags : null,
          notesType: updates && updates.notes !== undefined ? typeof updates.notes : 'undef'
        });

        const item = await repository.findById(itemId);
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

        if (updates.isFavorite !== undefined) {
          if (typeof updates.isFavorite !== 'boolean') {
            res.status(400).json({
              error: {
                code: 'INVALID_IS_FAVORITE',
                message: 'isFavorite must be a boolean'
              }
            });
            return;
          }
          updateFields.push(`is_favorite = $${values.length + 1}`);
          values.push(updates.isFavorite);
        }

        // Tags update is handled separately (item_tags is its own relation,
        // not a column on items). Skipping the field list here so we can
        // do the upsert + delete-many in a transaction below.
        const shouldUpdateTags = Array.isArray(updates.tags);

        if (updateFields.length === 0 && !shouldUpdateTags) {
          res.status(400).json({ error: { code: 'NO_UPDATES', message: 'No fields to update' } });
          return;
        }

        if (updateFields.length > 0) {
          updateFields.push(`updated_at = NOW()`);
          values.push(itemId);
          await pool.query(
            `UPDATE items SET ${updateFields.join(', ')} WHERE id = $${values.length}`,
            values
          );
        } else {
          await pool.query(
            `UPDATE items SET updated_at = NOW() WHERE id = $1`,
            [itemId]
          );
        }

        if (shouldUpdateTags) {
          const tagNames = (updates.tags as string[])
            .map(function(t) { return String(t || '').trim(); })
            .filter(function(t) { return t.length > 0 && t.length <= 32; });
          // Dedupe (case-insensitive) and cap to 16 tags per item so a
          // runaway client can't push thousands of labels.
          const seen: Record<string, boolean> = {};
          const uniqueNames: string[] = [];
          for (const name of tagNames) {
            const key = name.toLowerCase();
            if (seen[key]) continue;
            seen[key] = true;
            uniqueNames.push(name);
            if (uniqueNames.length >= 16) break;
          }

          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM item_tags WHERE item_id = $1`, [itemId]);
            for (const name of uniqueNames) {
              const tagRes = await client.query<{ id: string }>(
                `INSERT INTO tags (user_id, name, normalized_name)
                 VALUES ($1, $2, LOWER($2))
                 ON CONFLICT (user_id, normalized_name)
                 DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [userId, name]
              );
              const tagId = tagRes.rows[0] && tagRes.rows[0].id;
              if (!tagId) continue;
              await client.query(
                `INSERT INTO item_tags (item_id, tag_id)
                 VALUES ($1, $2)
                 ON CONFLICT (item_id, tag_id) DO NOTHING`,
                [itemId, tagId]
              );
            }
            await client.query('COMMIT');
          } catch (tagErr) {
            await client.query('ROLLBACK');
            throw tagErr;
          } finally {
            client.release();
          }
        }

        res.json({
          success: true,
          item: {
            id: itemId,
            isFavorite: updates.isFavorite ?? undefined,
            tags: shouldUpdateTags ? (updates.tags as string[]) : undefined
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/items/:id/image-url - Refresh a signed URL for an
  // image asset. Used by the dashboard when the original signed URL has
  // expired (Supabase Storage signed URLs are short-lived) and we want
  // to re-display the card without a full page reload.
  router.get(
    '/items/:id/image-url',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const itemId = String(req.params.id);

        const item = await repository.findById(itemId);
        if (!item || item.userId !== userId) {
          res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
          return;
        }

        const assets = await pool.query<{ storage_key: string }>(
          `SELECT storage_key FROM assets WHERE item_id = $1 LIMIT 1`,
          [itemId]
        );
        const storageKey = assets.rows[0]?.storage_key || null;

        if (!storageKey) {
          res.status(404).json({ error: { code: 'NO_IMAGE_ASSET', message: 'Item has no image asset' } });
          return;
        }

        let imageUrl: string | null = null;
        if (imageStorage && typeof imageStorage.createSignedUrl === 'function') {
          try {
            imageUrl = await imageStorage.createSignedUrl(storageKey, 60 * 60);
          } catch {
            imageUrl = null;
          }
        }
        if (!imageUrl && imageStorage && typeof imageStorage.createPublicUrl === 'function') {
          try {
            imageUrl = await imageStorage.createPublicUrl(storageKey);
          } catch {
            imageUrl = null;
          }
        }

        if (!imageUrl) {
          res.status(503).json({ error: { code: 'IMAGE_URL_UNAVAILABLE', message: 'Could not produce an image URL' } });
          return;
        }

        res.json({ data: { id: itemId, image_url: imageUrl } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
