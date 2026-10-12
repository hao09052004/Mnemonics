/**
 * Tag Routes
 *
 * Tag management endpoints - list, suggest, and filter.
 */

import express, { type Application, type Response, type Request } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TagRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
}

interface AuthedRequest extends Request {
  userId?: string;
  user?: { id: string; email?: string };
}

export function createTagRouter(deps: TagRouterDeps): Application {
  const { pool, supabase } = deps;
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
        res.status(401).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Tags require Supabase auth' } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/tags - List user's tags
  router.get(
    '/tags',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;

        const result = await pool.query<Record<string, unknown>>(
          `SELECT t.id, t.name, t.normalized_name,
                  COUNT(it.item_id) as item_count,
                  MAX(i.created_at) as last_used_at
           FROM tags t
           LEFT JOIN item_tags it ON it.tag_id = t.id
           LEFT JOIN items i ON i.id = it.item_id
           WHERE t.user_id = $1
           GROUP BY t.id, t.name, t.normalized_name
           ORDER BY item_count DESC, last_used_at DESC`,
          [userId]
        );

        res.json({
          tags: result.rows.map(row => ({
            id: row.id,
            name: row.name,
            normalized_name: row.normalized_name,
            item_count: parseInt(String(row.item_count || 0), 10),
            last_used_at: row.last_used_at
          })),
          total: result.rows.length
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/v1/tags/:name/items - Get items with this tag
  router.get(
    '/tags/:name/items',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const tagName = String(req.params.name).toLowerCase();

        const result = await pool.query<Record<string, unknown>>(
          `SELECT i.id, i.type, i.title, i.source_url, i.raw_text,
                  i.ocr_text, i.status, i.captured_at, i.created_at
           FROM items i
           JOIN item_tags it ON it.item_id = i.id
           JOIN tags t ON t.id = it.tag_id
           WHERE i.user_id = $1 AND t.normalized_name = $2
           ORDER BY i.created_at DESC
           LIMIT 100`,
          [userId, tagName]
        );

        res.json({
          tag: tagName,
          items: result.rows,
          total: result.rows.length
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/v1/tags/suggest - Suggest tags based on content
  router.post(
    '/tags/suggest',
    requireAuth,
    async (req: AuthedRequest, res: Response, next: (err?: unknown) => void) => {
      try {
        const userId = req.userId!;
        const { text, max = 5 } = req.body as { text?: string; max?: number };

        if (!text || text.length < 3) {
          res.status(400).json({ error: { code: 'TEXT_REQUIRED', message: 'Text is required' } });
          return;
        }

        // Extract candidate words
        const words = text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 3 && w.length <= 32);

        // Count word frequency
        const freq: Record<string, number> = {};
        for (const word of words) {
          freq[word] = (freq[word] || 0) + 1;
        }

        // Get existing tags for this user
        const userTags = await pool.query<{ name: string }>(
          `SELECT name FROM tags WHERE user_id = $1`,
          [userId]
        );

        const userTagSet = new Set(userTags.rows.map(t => t.name.toLowerCase()));

        // Prioritize matches with user's existing tags
        const suggestions: Array<{ tag: string; score: number; isExisting: boolean }> = [];

        for (const [word, count] of Object.entries(freq)) {
          const isExisting = userTagSet.has(word);
          suggestions.push({
            tag: word,
            score: count * (isExisting ? 2 : 1),
            isExisting
          });
        }

        suggestions.sort((a, b) => b.score - a.score);

        res.json({
          suggestions: suggestions.slice(0, max),
          existing_tags: Array.from(userTagSet)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
