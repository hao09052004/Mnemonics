/**
 * Search Routes
 *
 * Hybrid keyword + vector search endpoint.
 *
 * The search *logic* lives in `@mnemonics/database`'s `search-service`
 * so Smart Spaces resolve through the identical code path. This file
 * is transport only: auth, validation, and response shaping. Before
 * that extraction the ranking existed here as private functions, which
 * meant a Smart Space had to re-implement it in SQL — and the same
 * criteria returned different rows depending on where you asked.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';
import {
  hasMeaningfulCriteria,
  runSearch,
  SEARCH_KINDS,
  type SearchKind,
  type SearchRequest
} from '@mnemonics/database';
import type { EmbeddingProvider } from '@mnemonics/ai';

export interface SearchRouterDeps {
  pool: Pool;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  embeddings?: EmbeddingProvider;
}

// `q` is optional because the dashboard's filter chips send a
// filter-only request. A request with neither text nor any filter is
// still rejected so the endpoint cannot be used to page the whole
// table.
// A const tuple, so Zod keeps the literal members rather than widening
// to `string[]` — the widened form no longer satisfies SearchFilters.
const kindTuple = SEARCH_KINDS as unknown as [SearchKind, ...SearchKind[]];

const searchRequestSchema = z
  .object({
    q: z.string().max(512).optional().default(''),
    filters: z
      .object({
        tags: z.array(z.string().max(64)).max(20).optional(),
        kind: z.array(z.enum(kindTuple)).max(10).optional(),
        captured_after: z.string().datetime().optional(),
        captured_before: z.string().datetime().optional(),
        favorite: z.boolean().optional()
      })
      .optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
    explain: z.boolean().optional().default(false)
  })
  .refine((v) => hasMeaningfulCriteria(v as SearchRequest), {
    message: 'Provide q or at least one filter',
    path: ['q']
  });

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

  const handleSearch = async (
    req: AuthenticatedRequest,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    try {
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
      const result = await runSearch({ pool, embeddings }, req.userId!, {
        q,
        filters,
        limit,
        offset
      });

      res.json({
        hits: result.hits.map((hit) => ({
          id: hit.id,
          kind: hit.kind,
          title: hit.title,
          snippet: hit.snippet,
          score: hit.score,
          captured_at: hit.capturedAt,
          tags: hit.tags
        })),
        total: result.total,
        took_ms: result.tookMs,
        ...(explain && result.explain ? { explain_data: result.explain } : {})
      });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/v1/search — hybrid search.
  router.post('/search', requireAuth, handleSearch);

  // GET /api/v1/search — convenience for a bare keyword.
  router.get('/search', requireAuth, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const q = req.query.q as string;
      if (!q) {
        res.status(400).json({ error: { code: 'MISSING_QUERY', message: 'q parameter is required' } });
        return;
      }
      (req.body as Record<string, unknown>) = { q, limit: 20, offset: 0 };
      await handleSearch(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
