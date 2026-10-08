/**
 * The one search implementation.
 *
 * Extracted from `apps/api/src/routes/search.ts` so that Smart Spaces
 * and the search endpoint run the *same* code. Before this extraction
 * a Smart Space was resolved by a second, hand-written SQL dialect in
 * `packages/database/src/rule-engine.ts`, which meant the same query
 * typed into Everything could return a different set than the Space
 * built from it — the exact inconsistency the Spaces spec forbids
 * (specs/api/spaces.md §7).
 *
 * A saved Smart Space is a persisted `SearchRequest`. Opening it calls
 * `runSearch()` with that document. Nothing is materialised, so a
 * memory captured after the Space was created appears in it on the
 * next read with no write and no background job.
 */

import type { Pool } from 'pg';

/**
 * Minimal shape of the embedding provider this service needs.
 *
 * Declared structurally rather than imported from `@mnemonics/ai`:
 * the database package must not depend on the AI package, and all
 * that is required is "turn text into a vector". The API passes the
 * real provider, which satisfies this interface.
 */
export interface EmbeddingLike {
  embedOne(text: string): Promise<number[] | null>;
}

/** Content kinds the product exposes as filters. */
export const SEARCH_KINDS = ['link', 'text', 'image', 'screenshot', 'document'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/**
 * The persisted form of a Smart Space's criteria, and the same shape
 * the search route already accepts. `query` is the free-text term;
 * the remaining buckets mirror the dashboard's filter chips.
 */
export interface SearchFilters {
  tags?: string[];
  kind?: SearchKind[];
  captured_after?: string;
  captured_before?: string;
  /** Only favourites. Mirrors the dashboard's heart filter. */
  favorite?: boolean;
}

export interface SearchRequest {
  q?: string;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  score: number;
  capturedAt: Date;
  tags: string[];
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  tookMs: number;
  explain?: {
    lexResults: number;
    semResults: number;
    weights: { lex: number; sem: number };
  };
}

/** Ceiling on candidates pulled from either leg before fusion. */
const CANDIDATE_LIMIT = 100;
const RRF_K = 60;
/** Matches the weights the existing search route already shipped with. */
const LEX_WEIGHT = 0.4;
const SEM_WEIGHT = 0.6;

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * True when the request carries at least one real constraint.
 *
 * Both the search route and "Save as Space" use this: a bare request
 * with no query and no filters is not a search, so it is rejected
 * there and the "Save as Space" affordance stays hidden here. A Smart
 * Space matching everything would just be a second Everything view.
 */
export function hasMeaningfulCriteria(req: SearchRequest | null | undefined): boolean {
  if (!req) return false;
  if (typeof req.q === 'string' && req.q.trim().length > 0) return true;
  const f = req.filters;
  if (!f) return false;
  return Boolean(
    (f.tags && f.tags.length > 0) ||
    (f.kind && f.kind.length > 0) ||
    f.captured_after ||
    f.captured_before ||
    f.favorite === true
  );
}

/** Normalise a tag to the `normalized_name` form the DB stores. */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

interface RankedRow {
  id: string;
  type: string;
  title: string;
  rawText: string | null;
  ocrText: string | null;
  sourceUrl: string | null;
  capturedAt: Date;
  score: number;
  tags: string[];
}

export interface SearchDeps {
  pool: Pool;
  embeddings?: EmbeddingLike;
}

/**
 * Run the hybrid search. Shared by `POST /api/v1/search` and by
 * Smart Space resolution.
 */
export async function runSearch(
  deps: SearchDeps,
  userId: string,
  request: SearchRequest
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const q = (request.q ?? '').trim();
  const filters = request.filters;
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(request.offset ?? 0, 0);

  const [lexResults, semResults] = await Promise.all([
    runLexicalSearch(deps.pool, userId, q, filters),
    runSemanticSearch(deps.pool, userId, q, deps.embeddings, filters)
  ]);

  const fused = reciprocalRankFusion(lexResults, semResults, LEX_WEIGHT, SEM_WEIGHT);
  const paged = fused.slice(offset, offset + limit);

  return {
    hits: paged.map((item) => ({
      id: item.id,
      kind: item.type,
      title: item.title,
      snippet: buildSnippet(item, q),
      score: item.score,
      capturedAt: item.capturedAt,
      tags: item.tags
    })),
    total: fused.length,
    tookMs: Date.now() - startedAt,
    explain: {
      lexResults: lexResults.length,
      semResults: semResults.length,
      weights: { lex: LEX_WEIGHT, sem: SEM_WEIGHT }
    }
  };
}

/**
 * Resolve a Smart Space to item ids.
 *
 * Delegates to `runSearch`, so the result is by construction identical
 * to what the user would get by typing the Space's own criteria into
 * Everything. The cap is generous but finite: a Space is a filtered
 * view, not an export.
 */
export async function resolveSmartSpaceIds(
  deps: SearchDeps,
  userId: string,
  rule: SearchRequest,
  limit = MAX_LIMIT
): Promise<{ ids: string[]; total: number }> {
  const response = await runSearch(deps, userId, {
    q: rule.q ?? '',
    filters: rule.filters,
    limit: Math.min(Math.max(limit, 1), MAX_LIMIT)
  });
  return { ids: response.hits.map((h) => h.id), total: response.total };
}

/**
 * Postgres full-text leg.
 *
 * A blank query is treated as "no text constraint", not as a
 * tsquery that matches nothing: `plainto_tsquery('simple','')` yields
 * a 0-node tsquery and `tsvector @@ ''::tsquery` is false for every
 * row, which would make a filter-only request return nothing. In that
 * case rows are ranked by recency.
 */
async function runLexicalSearch(
  pool: Pool,
  userId: string,
  query: string,
  filters?: SearchFilters
): Promise<RankedRow[]> {
  const isBlank = query.length === 0;

  const doc = `
    setweight(to_tsvector('simple', coalesce(i.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(i.raw_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(i.ocr_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(e.tldr, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(e.caption, '')), 'C')`;

  let sql = `
    SELECT i.id, i.type, i.title, i.raw_text, i.ocr_text, i.source_url, i.captured_at,
           ${
             isBlank
               ? `EXTRACT(EPOCH FROM (NOW() - i.captured_at))::float8 * -1e-6`
               : `ts_rank_cd(${doc}, plainto_tsquery('simple', $2))`
           } AS score
    FROM items i
    LEFT JOIN item_enrichments e ON e.item_id = i.id
    WHERE i.user_id = $1
      AND i.status = 'ready'`;

  if (!isBlank) {
    sql += ` AND ${doc} @@ plainto_tsquery('simple', $2)`;
  }

  // Placeholders are positional, so the parameter array must line up
  // with the numbered references exactly. $2 only exists when the
  // query is non-blank, so filter placeholders start after it.
  const params: unknown[] = [userId];
  let next = 2;
  if (!isBlank) {
    params.push(query);
    next = 3;
  }

  const normalizedTags = normalizeTagList(filters?.tags);
  const kinds = normalizeKindList(filters?.kind);

  if (normalizedTags.length > 0) {
    sql += ` AND EXISTS (
      SELECT 1 FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = i.id
        AND t.user_id = i.user_id
        AND t.normalized_name = ANY($${next})
    )`;
    params.push(normalizedTags);
    next += 1;
  }
  if (kinds && kinds.length > 0) {
    sql += ` AND i.type = ANY($${next})`;
    params.push(kinds);
    next += 1;
  }
  if (filters?.captured_after) {
    sql += ` AND i.captured_at >= $${next}`;
    params.push(filters.captured_after);
    next += 1;
  }
  if (filters?.captured_before) {
    sql += ` AND i.captured_at <= $${next}`;
    params.push(filters.captured_before);
    next += 1;
  }
  if (filters?.favorite === true) {
    // A guarded form rather than a bound boolean: the column only
    // exists from migration 011, and a filter that cannot be honoured
    // should read as "no filter" instead of erroring the whole search.
    sql += ` AND (CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'items' AND column_name = 'is_favorite'
    ) THEN i.is_favorite ELSE false END) = true`;
  }

  sql += ` ORDER BY score DESC, i.captured_at DESC LIMIT ${CANDIDATE_LIMIT}`;

  const result = await pool.query<Record<string, unknown>>(sql, params);
  const ids = result.rows.map((r) => String(r.id));

  // Tags are needed for the card UI. One extra round trip for the
  // whole page beats a correlated subquery per row.
  const tagMap = await loadTagsForItems(pool, ids);

  return result.rows.map((row) => {
    const id = String(row.id);
    return {
      id,
      type: String(row.type),
      title: String(row.title ?? ''),
      rawText: (row.raw_text as string | null) || null,
      ocrText: (row.ocr_text as string | null) || null,
      sourceUrl: (row.source_url as string | null) || null,
      capturedAt: new Date(row.captured_at as string),
      score: parseFloat(String(row.score)) || 0,
      tags: tagMap.get(id) ?? []
    };
  });
}

/**
 * pgvector leg. Skipped when there is no provider (free/offline
 * deploy) or no query text, because embedding an empty string yields
 * a meaningless vector that would outrank the lexical hits.
 */
async function runSemanticSearch(
  pool: Pool,
  userId: string,
  query: string,
  embeddings: EmbeddingLike | undefined,
  filters?: SearchFilters
): Promise<RankedRow[]> {
  if (!embeddings || query.length === 0) return [];

  try {
    const vector = await embeddings.embedOne(query);
    if (!vector || vector.length === 0) return [];

    const result = await pool.query<Record<string, unknown>>(
      `SELECT ie.item_id AS id, i.type, i.title, i.raw_text, i.ocr_text,
              i.source_url, i.captured_at,
              1 - (ie.embedding <=> $2::vector) AS score
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
       WHERE i.user_id = $1
         AND i.status = 'ready'
         AND ie.embedding_kind = 'real'
         AND ($3::text[] IS NULL OR i.type = ANY($3))
         AND ($4::timestamptz IS NULL OR i.captured_at >= $4)
         AND ($5::timestamptz IS NULL OR i.captured_at <= $5)
         AND ($6::text[] IS NULL OR EXISTS (
           SELECT 1 FROM item_tags it
           JOIN tags t ON t.id = it.tag_id
           WHERE it.item_id = i.id
             AND t.user_id = i.user_id
             AND t.normalized_name = ANY($6)
         ))
         AND ($7::boolean IS NOT TRUE OR i.is_favorite = true)
       ORDER BY ie.embedding <=> $2::vector
       LIMIT ${CANDIDATE_LIMIT}`,
      [
        userId,
        `[${vector.join(',')}]`,
        normalizeKindList(filters?.kind),
        filters?.captured_after ?? null,
        filters?.captured_before ?? null,
        normalizeTagList(filters?.tags),
        filters?.favorite === true ? true : null
      ]
    );

    const ids = result.rows.map((r) => String(r.id));
    const tagMap = await loadTagsForItems(pool, ids);

    return result.rows.map((row) => {
      const id = String(row.id);
      return {
        id,
        type: String(row.type),
        title: String(row.title ?? ''),
        rawText: (row.raw_text as string | null) || null,
        ocrText: (row.ocr_text as string | null) || null,
        sourceUrl: (row.source_url as string | null) || null,
        capturedAt: new Date(row.captured_at as string),
        score: parseFloat(String(row.score)) || 0,
        tags: tagMap.get(id) ?? []
      };
    });
  } catch (error) {
    // A missing pgvector extension or an absent embedding provider must
    // degrade to lexical-only, never fail the whole search.
    console.error('[search] semantic leg failed, falling back to lexical:', error);
    return [];
  }
}

/** Batch-load tags for a page of items in one query. */
async function loadTagsForItems(pool: Pool, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const result = await pool.query<{ item_id: string; name: string }>(
    `SELECT it.item_id, t.name
     FROM item_tags it
     JOIN tags t ON t.id = it.tag_id
     WHERE it.item_id = ANY($1::uuid[])
     ORDER BY t.name`,
    [ids]
  );
  for (const row of result.rows) {
    const list = out.get(row.item_id) ?? [];
    list.push(row.name);
    out.set(row.item_id, list);
  }
  return out;
}

/**
 * Reciprocal Rank Fusion.
 *
 * Ranking is by rank position, not by raw score, so a lexical score
 * of 0.9 and a cosine of 0.83 are comparable without normalisation.
 */
function reciprocalRankFusion(
  lexResults: RankedRow[],
  semResults: RankedRow[],
  lexWeight: number,
  semWeight: number
): RankedRow[] {
  const scores = new Map<string, { lex: number; sem: number; item: RankedRow }>();

  lexResults.forEach((item, index) => {
    scores.set(item.id, { lex: (1 / (RRF_K + index + 1)) * lexWeight, sem: 0, item });
  });

  semResults.forEach((item, index) => {
    const contribution = (1 / (RRF_K + index + 1)) * semWeight;
    const existing = scores.get(item.id);
    if (existing) {
      existing.sem = contribution;
    } else {
      scores.set(item.id, { lex: 0, sem: contribution, item });
    }
  });

  return Array.from(scores.values())
    .map(({ lex, sem, item }) => ({ ...item, score: lex + sem }))
    .sort((a, b) => b.score - a.score);
}

function buildSnippet(item: RankedRow, query: string): string {
  const text = item.ocrText || item.rawText || item.title || '';
  if (!query) return text.slice(0, 240);
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text.slice(0, 240);
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

function normalizeTagList(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  return tags.map(normalizeTag).filter((t) => t.length > 0);
}

function normalizeKindList(kinds: SearchKind[] | string[] | undefined): string[] | null {
  if (!kinds || kinds.length === 0) return null;
  const allowed = new Set<string>(SEARCH_KINDS);
  return kinds.filter((k) => allowed.has(k));
}
