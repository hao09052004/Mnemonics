/**
 * Search Routes
 *
 * Hybrid keyword + vector search endpoint.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';
import type { EmbeddingProvider } from '@mnemonics/ai';

export interface SearchRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  embeddings?: EmbeddingProvider;
}

// The dashboard's filter chips send a filter-only request (no text typed
// yet). `q` is therefore optional, but a request with neither text nor any
// filter is still rejected so the endpoint cannot be used to page the whole
// table. The blank-query case is handled in runLexicalSearch: an empty
// tsquery matches nothing, so the `@@` clause is dropped and rows are
// ranked by recency instead.
const searchFiltersSchema = z.object({
  tags: z.array(z.string()).optional(),
  kind: z.array(z.enum(['link', 'text', 'image', 'screenshot'])).optional(),
  captured_after: z.string().datetime().optional(),
  captured_before: z.string().datetime().optional()
});

const searchRequestSchema = z
  .object({
    q: z.string().max(512).optional().default(''),
    filters: searchFiltersSchema.optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
    explain: z.boolean().optional().default(false)
  })
  .refine(
    (v) => v.q.trim().length > 0 || (v.filters?.kind?.length ?? 0) + (v.filters?.tags?.length ?? 0) > 0,
    { message: 'Provide q or at least one filter', path: ['q'] }
  );

interface LexResult {
  id: string;
  type: string;
  title: string;
  raw_text: string | null;
  ocr_text: string | null;
  source_url: string | null;
  captured_at: Date;
  score: number;
  tags?: string[];
}

interface SemResult {
  id: string;
  type: string;
  title: string;
  raw_text: string | null;
  ocr_text: string | null;
  source_url: string | null;
  captured_at: Date;
  score: number;
}

export function createSearchRouter(deps: SearchRouterDeps): Application {
  const {
    pool,
    supabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001',
    embeddings
  } = deps;
  const router = express.Router() as Application;

  const requireAuth = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  /**
   * Handle search logic for both POST and GET
   */
  const handleSearch = async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    try {
      const startTime = Date.now();
      const userId = req.userId!;

      // Validate request
      const parsed = searchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_SEARCH_REQUEST',
            message: 'Invalid search parameters',
            details: parsed.error.issues
          }
        });
        return;
      }

      const { q, filters, limit, offset, explain } = parsed.data;

      // Run lexical search (Postgres FTS)
      const lexResults = await runLexicalSearch(pool, userId, q, filters);

      // Run semantic search (vector)
      const semResults = await runSemanticSearch(pool, userId, q, embeddings, filters);

      // Combine with RRF
      const combined = reciprocalRankFusion(lexResults, semResults, 0.4, 0.6);

      // Apply pagination
      const paged = combined.slice(offset, offset + limit);

      // Build response
      const hits = paged.map(item => ({
        id: item.id,
        kind: item.type,
        title: item.title,
        snippet: buildSnippet(item, q),
        score: item.score,
        captured_at: item.captured_at,
        tags: item.tags || []
      }));

      const response: {
        hits: typeof hits;
        total: number;
        took_ms: number;
      } = {
        hits,
        total: combined.length,
        took_ms: Date.now() - startTime
      };

      if (explain) {
        (response as { explain_data?: unknown }).explain_data = {
          lex_results: lexResults.length,
          sem_results: semResults.length,
          weights: { lex: 0.4, sem: 0.6 }
        };
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  // POST /api/v1/search - Hybrid search
  router.post('/search', requireAuth, handleSearch);

  // GET /api/v1/search - Simple search (query params)
  router.get('/search', requireAuth, async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    try {
      const q = req.query.q as string;
      if (!q) {
        res.status(400).json({ error: { code: 'MISSING_QUERY', message: 'q parameter is required' } });
        return;
      }
      // Forward to POST handler logic
      (req.body as Record<string, unknown>) = { q, limit: 20, offset: 0 };
      await handleSearch(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Run lexical search using Postgres full-text search
 */
async function runLexicalSearch(
  pool: Pool,
  userId: string,
  query: string,
  filters?: {
    tags?: string[];
    kind?: string[];
    captured_after?: string;
    captured_before?: string;
  }
): Promise<LexResult[]> {
  // An empty/blank query must behave as "no text constraint", not as a
  // tsquery that matches nothing. Postgres returns a 0-node tsquery for
  // plainto_tsquery('simple',''), and `tsvector @@ ''::tsquery` is false
  // for every row, so the filter-only request the dashboard's filter chips
  // send (q: '' + filters.kind) used to return zero hits no matter what
  // the filters were. When the query is blank we drop the @@ clause and
  // rank by recency instead.
  const isBlankQuery = query.trim().length === 0;

  let sql = `
    SELECT
      i.id,
      i.type,
      i.title,
      i.raw_text,
      i.ocr_text,
      i.source_url,
      i.captured_at,
      ${
        isBlankQuery
          ? `EXTRACT(EPOCH FROM (NOW() - i.captured_at))::float8 * -1e-6`
          : `ts_rank_cd(
        setweight(to_tsvector('simple', coalesce(i.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(i.raw_text, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(i.ocr_text, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(e.tldr, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(e.caption, '')), 'C'),
        plainto_tsquery('simple', $2)
      )`
      } AS score
    FROM items i
    LEFT JOIN item_enrichments e ON e.item_id = i.id
    WHERE i.user_id = $1
      AND i.status = 'ready'
      ${
        isBlankQuery
          ? ''
          : `AND (
        setweight(to_tsvector('simple', coalesce(i.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(i.raw_text, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(i.ocr_text, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(e.tldr, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(e.caption, '')), 'C')
      ) @@ plainto_tsquery('simple', $2)`
      }
  `;

  // Placeholders are positional, so the parameter array has to match the
  // numbered references exactly. A blank query means the `@@ ... $2` clause
  // is absent, so passing '' as a second parameter made Postgres fail with
  // "could not determine data type of parameter $2". Only bind the query
  // when the SQL actually references it, and start the filter placeholders
  // right after.
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (!isBlankQuery) {
    params.push(query);
    paramIndex = 3;
  }

  if (filters?.tags?.length) {
    sql += ` AND EXISTS (
      SELECT 1
      FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = i.id
        AND t.user_id = i.user_id
        AND t.normalized_name = ANY(${paramIndex})
    )`;
    params.push(filters.tags.map(tag => tag.trim().toLowerCase().replace(/\s+/g, '-')));
    paramIndex++;
  }

  if (filters?.kind?.length) {
    sql += ` AND i.type = ANY($${paramIndex})`;
    params.push(filters.kind);
    paramIndex++;
  }

  if (filters?.captured_after) {
    sql += ` AND i.captured_at >= $${paramIndex}`;
    params.push(filters.captured_after);
    paramIndex++;
  }

  if (filters?.captured_before) {
    sql += ` AND i.captured_at <= $${paramIndex}`;
    params.push(filters.captured_before);
    paramIndex++;
  }

  sql += ` ORDER BY score DESC LIMIT 100`;

  const result = await pool.query<Record<string, unknown>>(sql, params);
  return result.rows.map(row => ({
    id: row.id as string,
    type: row.type as string,
    title: row.title as string,
    raw_text: (row.raw_text as string | null) || null,
    ocr_text: (row.ocr_text as string | null) || null,
    source_url: (row.source_url as string | null) || null,
    captured_at: new Date(row.captured_at as string),
    score: parseFloat(String(row.score))
  }));
}

/**
 * Run semantic search using embeddings
 */
async function runSemanticSearch(
  pool: Pool,
  userId: string,
  query: string,
  embeddings?: EmbeddingProvider,
  filters?: {
    tags?: string[];
    kind?: string[];
    captured_after?: string;
    captured_before?: string;
  }
): Promise<SemResult[]> {
  if (!embeddings) {
    return [];
  }

  // A blank query has no embedding to compare against — embedding the empty
  // string returns a meaningless vector that would rank every item
  // arbitrarily and drown out the lexical hits from a filter-only request.
  if (query.trim().length === 0) {
    return [];
  }

  try {
    const queryEmbedding = await embeddings.embedOne(query);
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const result = await pool.query<Record<string, unknown>>(
      `SELECT
        ie.item_id AS id,
        i.type,
        i.title,
        i.raw_text,
        i.ocr_text,
        i.source_url,
        i.captured_at,
        1 - (ie.embedding <=> $2::vector) AS score
      FROM item_embeddings ie
      JOIN items i ON i.id = ie.item_id
      WHERE i.user_id = $1
        AND i.status = 'ready'
        AND ($3::text[] IS NULL OR i.type = ANY($3))
        AND ($4::timestamptz IS NULL OR i.captured_at >= $4)
        AND ($5::timestamptz IS NULL OR i.captured_at <= $5)
        AND ($6::text[] IS NULL OR EXISTS (
          SELECT 1
          FROM item_tags it
          JOIN tags t ON t.id = it.tag_id
          WHERE it.item_id = i.id
            AND t.user_id = i.user_id
            AND t.normalized_name = ANY($6)
        ))
      ORDER BY ie.embedding <=> $2::vector
      LIMIT 100`,
      [
        userId,
        embeddingStr,
        filters?.kind ?? null,
        filters?.captured_after ?? null,
        filters?.captured_before ?? null,
        filters?.tags?.map(tag => tag.trim().toLowerCase().replace(/\s+/g, '-')) ?? null
      ]
    );

    return result.rows.map(row => ({
      id: row.id as string,
      type: row.type as string,
      title: row.title as string,
      raw_text: (row.raw_text as string | null) || null,
      ocr_text: (row.ocr_text as string | null) || null,
      source_url: (row.source_url as string | null) || null,
      captured_at: new Date(row.captured_at as string),
      score: parseFloat(String(row.score))
    }));
  } catch (error) {
    console.error('[Search] Semantic search error:', error);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion combining lexical and semantic results
 */
function reciprocalRankFusion(
  lexResults: LexResult[],
  semResults: SemResult[],
  lexWeight: number,
  semWeight: number
): Array<LexResult & { combinedScore: number; score: number }> {
  const RRF_K = 60;
  const scores: Map<string, { lex: number; sem: number; item: LexResult }> = new Map();

  lexResults.forEach((item, index) => {
    const rank = index + 1;
    const lexScore = 1 / (RRF_K + rank) * lexWeight;
    scores.set(item.id, { lex: lexScore, sem: 0, item });
  });

  semResults.forEach((result, index) => {
    const rank = index + 1;
    const semScore = 1 / (RRF_K + rank) * semWeight;
    const existing = scores.get(result.id);
    if (existing) {
      existing.sem = semScore;
    } else {
      scores.set(result.id, {
        lex: 0,
        sem: semScore,
        item: {
          id: result.id,
          type: result.type,
          title: result.title,
          captured_at: result.captured_at,
          raw_text: result.raw_text,
          ocr_text: result.ocr_text,
          source_url: result.source_url,
          score: 0
        }
      });
    }
  });

  return Array.from(scores.values())
    .map(({ lex, sem, item }) => ({
      ...item,
      score: lex + sem,
      combinedScore: lex + sem
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Build a snippet from search result
 */
function buildSnippet(item: LexResult, query: string): string {
  const text = item.ocr_text || item.raw_text || item.title || '';
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  const index = textLower.indexOf(queryLower);
  if (index === -1) {
    return text.slice(0, 240);
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  let snippet = text.slice(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}
