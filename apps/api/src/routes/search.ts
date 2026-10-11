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
  type SearchFilters,
  type SearchKind,
  type SearchRequest
} from '@mnemonics/database';
import { parseQuery } from '@mnemonics/database';
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
        favorite: z.boolean().optional(),
        structured: z
          .object({
            detectedType: z
              .array(
                z.enum([
                  'article','product','recipe','video','quote','highlight',
                  'webpage','image','note','document','other'
                ])
              )
              .optional(),
            category: z.array(z.string().max(80)).max(16).optional(),
            brand: z.array(z.string().max(80)).max(16).optional(),
            material: z.array(z.string().max(80)).max(16).optional(),
            color: z.array(z.string().max(80)).max(16).optional(),
            merchant: z.array(z.string().max(80)).max(16).optional(),
            author: z.array(z.string().max(120)).max(16).optional()
          })
          .optional()
      })
      .optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
    explain: z.boolean().optional().default(false)
  })
  .refine((v) => hasMeaningfulCriteria(v as SearchRequest), {
    message: 'Provide q or at least one filter',
    path: ['q']
  })
  .and(
    z.object({
      mode: z.enum(['lexical', 'semantic', 'hybrid']).optional().default('hybrid')
    })
  );

/**
 * M3 — merge the deterministic query-parser output into a
 * SearchRequest. Existing values win (so the user can pass
 * explicit `filters` AND a natural-language `q` at the same
 * time, and the explicit values take precedence).
 */
function applyQueryParser(req: SearchRequest, parsedQ: ReturnType<typeof parseQuery>): SearchRequest {
  const merged: SearchRequest = {
    ...req,
    filters: req.filters ? { ...req.filters } : {}
  };
  if (!merged.filters) {
    merged.filters = {};
  }
  if (parsedQ.captured_after && !merged.filters.captured_after) {
    merged.filters.captured_after = parsedQ.captured_after;
  }
  if (parsedQ.captured_before && !merged.filters.captured_before) {
    merged.filters.captured_before = parsedQ.captured_before;
  }
  if (parsedQ.structured) {
    const existingStructured = merged.filters.structured ?? {};
    const outStructured: SearchFilters['structured'] = { ...existingStructured };
    for (const k of ['detectedType','category','brand','material','color','merchant','author'] as const) {
      const incoming = parsedQ.structured[k];
      if (incoming && incoming.length > 0 && (!outStructured[k] || outStructured[k]!.length === 0)) {
        // Cast to the right array type — Zod inferred `string` so we
        // re-narrow at the boundary by trusting the parser's
        // controlled vocabulary.
        (outStructured as Record<string, unknown>)[k] = incoming;
      }
    }
    merged.filters.structured = outStructured;
  }
  if (parsedQ.residualQ && !req.q) {
    merged.q = parsedQ.residualQ;
  } else if (parsedQ.residualQ && req.q) {
    merged.q = `${req.q} ${parsedQ.residualQ}`.trim();
  } else if (!req.q) {
    merged.q = '';
  }
  return merged;
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

      const { q, filters, limit, offset, explain, mode } = parsed.data;

      // Semantic-search entitlement gate. The Memory plan
      // is limited to lexical + hybrid (the vector leg is
      // only used for tie-breaking). Mastery unlocks pure
      // semantic search.
      if (mode === 'semantic' && pool) {
        const { getEntitlement } = await import('../entitlements.js');
        const ent = await getEntitlement(pool, req.userId!);
        if (!ent.semanticSearchEnabled) {
          res.status(402).json({
            error: {
              code: 'MASTERY_REQUIRED',
              message: 'Semantic search is part of the Mastery plan. Upgrade to use AI Semantic Search.',
              requestId: req.id
            },
            data: { plan: ent.family, validUntil: ent.validUntil }
          });
          return;
        }
      }

      // M3 — parse the free-text query into structured filters
      // and a residual `q` for the semantic leg. Existing
      // explicit values win.
      const parsedQuery = q ? parseQuery(q) : null;
      const merged: SearchRequest = parsedQuery
        ? applyQueryParser({ q, filters, limit, offset }, parsedQuery)
        : { q, filters, limit, offset };
      const result = await runSearch({ pool, embeddings }, req.userId!, merged);
      // Emit a single analytics event per search call. We record
      // the mode + the filter shape but never the query text
      // (privacy contract — see migration 031).
      const searchMode = (merged.filters && (merged.filters as { mode?: string }).mode) || 'lexical';
      if (req.userId) {
        const { emitAnalyticsEvent } = await import('../analytics.js');
        emitAnalyticsEvent(pool, {
          userId: req.userId,
          eventName: searchMode === 'semantic' ? 'semantic_search_performed' : 'search_performed',
          metadata: {
            hasFilters: Boolean(merged.filters),
            hitCount: result.total
          }
        });
      }

      res.json({
        hits: result.hits.map((hit) => ({
          id: hit.id,
          kind: hit.kind,
          title: hit.title,
          snippet: hit.snippet,
          page_start: hit.pageStart,
          page_end: hit.pageEnd,
          chunk_index: hit.chunkIndex,
          score: hit.score,
          captured_at: hit.capturedAt,
          tags: hit.tags,
          ...(hit.explanation ? { explanation: hit.explanation } : {})
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
