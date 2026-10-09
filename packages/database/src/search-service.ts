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
import { buildSearchHitExplanation } from './search-explainability.js';

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
  /** When the hit came from the chunk leg, the matched chunk's
   *  page range. null otherwise. */
  pageStart: number | null;
  pageEnd: number | null;
  /** Position of the matched chunk inside its parent document.
   *  null for non-chunk hits. */
  chunkIndex: number | null;
  score: number;
  capturedAt: Date;
  tags: string[];
  /** M7 — present only when SEARCH_EXPLAINABILITY_ENABLED=true. */
  explanation?: {
    lexical: number;
    vector: number;
    chunk: number;
    rrf: number;
    rerank: number | null;
  };
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  tookMs: number;
  explain?: {
    lexResults: number;
    semResults: number;
    chunkResults: number;
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
 * M5 — re-rank constants and types.
 *
 * Re-rank is a post-RRF step that blends the existing
 * reciprocal-rank-fusion score with a second-pass cosine
 * similarity against the query embedding. It is gated by
 * the `SEARCH_RERANK_ENABLED` env var in `runSearch`; this
 * module-level constant is the only knob.
 */
export const RERANK_ALPHA = 0.3;

export interface RerankHit {
  id: string;
  /** Score (post-blend when re-rank ran, RRF-only otherwise). */
  score: number;
  /** Optional pre-computed embedding for the hit. null when the
   *  search did not compute one (lexical-only hits). */
  embedding: number[] | null;
  /** Per-leg scores for the explainability surface (M7). */
  lexical: number;
  vector: number;
  /** The post-RRF score before re-rank. */
  rrf: number;
}

export interface RerankOptions {
  /** Query embedding, or null for lexical-only requests. */
  queryEmbedding: number[] | null;
}

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
  /** When the row came from the chunk leg, the matched chunk's
   *  text. Empty for item-level legs. */
  chunkExcerpt?: string | null;
  /** 1-based page number the matched chunk was estimated to
   *  start on. null when the document has no page info. */
  chunkPageStart?: number | null;
  /** 1-based inclusive page number the matched chunk was
   *  estimated to end on. null when no page info. */
  chunkPageEnd?: number | null;
  /** Position of the matched chunk inside its parent document. */
  chunkIndex?: number | null;
  /** M5 — per-hit embedding, when the leg returned one. null
   *  for legs that do not return a vector. The re-rank step
   *  reads this; if all hits have null, the re-rank is a
   *  no-op. */
  embedding?: number[] | null;
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

  const [lexResults, semResults, chunkResults] = await Promise.all([
    runLexicalSearch(deps.pool, userId, q, filters),
    runSemanticSearch(deps.pool, userId, q, deps.embeddings, filters),
    runChunkSemanticSearch(deps.pool, userId, q, deps.embeddings, filters)
  ]);

  // The chunk leg produces the same shape as the item-level legs
  // (item id + score) but is born from a different similarity join
  // (chunks instead of items). It feeds into the same RRF so a
  // long-PDF phrase that ONLY matches a chunk can still rank
  // alongside item-level hits. The leg weight is small but non-
  // zero: a chunk match is a stronger signal than a generic
  // item-level cosine, but it is also less stable across
  // re-chunking, so it should not dominate.
  const fused = reciprocalRankFusion(
    lexResults,
    [...semResults, ...chunkResults],
    LEX_WEIGHT,
    SEM_WEIGHT
  );

  // M5 re-rank gate. Default OFF. When ON, the RRF-fused hit list
  // is re-ranked with a second-pass cosine against the query
  // embedding, blended at RERANK_ALPHA. Cardinality is preserved;
  // only the order changes.
  //
  // Note: in this milestone no leg returns per-hit embeddings in
  // `fused`, so when re-rank is on it falls through to its no-op
  // path (cosine = 0 for every hit). This is intentional: M5 ships
  // the *infrastructure* and the unit-tested semantics. Surfacing
  // per-hit embeddings through the legs is a future change that
  // M7 (explainability) is the natural home for — when M7 adds
  // per-hit embeddings to the response, the re-rank step becomes
  // live automatically. The unit tests in
  // `packages/database/src/__tests__/search-rerank.test.ts` pin
  // the blend math regardless.
  const rerankEnabled = process.env.SEARCH_RERANK_ENABLED === 'true';
  let queryEmbeddingForRerank: number[] | null = null;
  if (rerankEnabled && q && deps.embeddings) {
    try {
      queryEmbeddingForRerank = (await deps.embeddings.embedOne(q)) ?? null;
    } catch {
      queryEmbeddingForRerank = null;
    }
  }
  const finalHits: RankedRow[] = rerankEnabled
    ? (rerankHits(fused, { queryEmbedding: queryEmbeddingForRerank }) as RankedRow[])
    : fused;

  const paged = finalHits.slice(offset, offset + limit);

  // M7 — per-hit explainability tracker. Built up alongside
  // the legs and the RRF step. The dashboard reads this when
  // SEARCH_EXPLAINABILITY_ENABLED is on.
  const explainabilityEnabled = process.env.SEARCH_EXPLAINABILITY_ENABLED === 'true';
  const perId = new Map<string, { lexical: number; vector: number; chunk: number; rrf: number; rerank: number | null }>();
  function track(id: string, leg: 'lexical' | 'vector' | 'chunk', score: number) {
    let entry = perId.get(id);
    if (!entry) {
      entry = { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null };
      perId.set(id, entry);
    }
    entry[leg] = score;
  }
  for (const row of lexResults) track(row.id, 'lexical', row.score);
  for (const row of semResults) track(row.id, 'vector', row.score);
  for (const row of chunkResults) track(row.id, 'chunk', row.score);
  for (const row of finalHits) {
    let entry = perId.get(row.id);
    if (!entry) {
      entry = { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null };
      perId.set(row.id, entry);
    }
    // Re-rank is identity in M5 (no per-hit embedding in
    // fused), so rerank == rrf. When M7's future per-hit
    // embedding plumbing lands, this line becomes the
    // post-re-rank score.
    entry.rrf = row.score;
    entry.rerank = row.score;
  }

  return {
    hits: paged.map((item) => {
      const snip = buildSnippet(item, q);
      const explanation = explainabilityEnabled
        ? buildSearchHitExplanation({
            ...(perId.get(item.id) ?? { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null }),
            rerankEnabled: true
          })
        : undefined;
      return {
        id: item.id,
        kind: item.type,
        title: item.title,
        snippet: snip.snippet,
        pageStart: snip.pageStart,
        pageEnd: snip.pageEnd,
        chunkIndex: snip.chunkIndex,
        score: item.score,
        capturedAt: item.capturedAt,
        tags: item.tags,
        ...(explanation ? { explanation } : {})
      };
    }),
    total: fused.length,
    tookMs: Date.now() - startedAt,
    explain: {
      lexResults: lexResults.length,
      semResults: semResults.length,
      chunkResults: chunkResults.length,
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

/**
 * Chunk-level semantic leg (Milestone 4).
 *
 * Searches the `item_document_chunks_real` view (the read
 * surface that excludes legacy / unknown embeddings) and
 * aggregates hits back to the parent item. The aggregation is
 * "best chunk wins" — for each item, the chunk with the
 * highest cosine similarity contributes to the RRF rank. This
 * is a deliberate trade-off vs RRF-within-document: the
 * top-chunk score is what the user actually wants ("the
 * document that contains a paragraph that closely matches my
 * query"), and it is cheaper to compute.
 *
 * Like the item-level leg, this is best-effort: a missing
 * pgvector extension or a missing `item_document_chunks`
 * table (older deploys) is logged and degrades to "no chunk
 * hits" rather than failing the whole search.
 */
async function runChunkSemanticSearch(
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
      `SELECT c.item_id AS id, i.type, i.title, i.raw_text, i.ocr_text,
              i.source_url, i.captured_at,
              MAX(1 - (c.embedding <=> $2::vector)) AS score,
              (array_agg(c.content ORDER BY (c.embedding <=> $2::vector) ASC))[1] AS chunk_excerpt,
              (array_agg(c.page_start ORDER BY (c.embedding <=> $2::vector) ASC))[1] AS chunk_page_start,
              (array_agg(c.page_end ORDER BY (c.embedding <=> $2::vector) ASC))[1] AS chunk_page_end,
              (array_agg(c.chunk_index ORDER BY (c.embedding <=> $2::vector) ASC))[1] AS chunk_index
         FROM item_document_chunks_real c
         JOIN items i ON i.id = c.item_id
        WHERE c.user_id = $1
          AND i.status = 'ready'
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
        GROUP BY c.item_id, i.type, i.title, i.raw_text, i.ocr_text,
                 i.source_url, i.captured_at
        ORDER BY score DESC
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
        tags: tagMap.get(id) ?? [],
        chunkExcerpt: (row.chunk_excerpt as string | null) ?? null,
        chunkPageStart: row.chunk_page_start == null ? null : Number(row.chunk_page_start),
        chunkPageEnd: row.chunk_page_end == null ? null : Number(row.chunk_page_end),
        chunkIndex: row.chunk_index == null ? null : Number(row.chunk_index),
      };
    });
  } catch (error) {
    // Older deploys may not have the chunks table yet. Log and
    // degrade to no chunk hits; the rest of the search still
    // works on the item-level leg.
    console.error('[search] chunk leg failed, ignoring:', error);
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

function buildSnippet(item: RankedRow, query: string): { snippet: string; pageStart: number | null; pageEnd: number | null; chunkIndex: number | null } {
  // When the row came from the chunk leg we have a pre-baked
  // excerpt that was already trimmed around the matched
  // content. Prefer that over re-running the match on rawText
  // because rawText can be tens of thousands of characters
  // long and the chunk excerpt already lives near the match.
  if (item.chunkExcerpt) {
    const start = item.chunkPageStart;
    const end = item.chunkPageEnd;
    return {
      snippet: item.chunkExcerpt.slice(0, 320),
      pageStart: start ?? null,
      pageEnd: end ?? null,
      chunkIndex: item.chunkIndex ?? null,
    };
  }
  const text = item.ocrText || item.rawText || item.title || '';
  if (!query) {
    return { snippet: text.slice(0, 240), pageStart: null, pageEnd: null, chunkIndex: null };
  }
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) {
    return { snippet: text.slice(0, 240), pageStart: null, pageEnd: null, chunkIndex: null };
  }
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  return {
    snippet: (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : ''),
    pageStart: null,
    pageEnd: null,
    chunkIndex: null,
  };
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

/**
 * Re-rank a fused hit list by blending RRF with a second-pass
 * cosine similarity against the query embedding.
 *
 *   score = (1 - RERANK_ALPHA) * rrf + RERANK_ALPHA * cosine(query, hit.embedding)
 *
 * Identity when the query embedding is null (lexical-only path)
 * or when no hit carries an embedding. Cardinality is preserved.
 *
 * Generic over the hit type so the caller (which already has a
 * typed fused list of `RankedRow[]`) does not have to re-shape
 * its data to call this. The input must carry `id`, `score`,
 * and `embedding: number[] | null` fields; the function returns
 * the same type with the `score` field replaced.
 */
export function rerankHits<T extends { id: string; score: number; embedding?: number[] | null }>(
  hits: T[],
  opts: RerankOptions
): T[] {
  if (opts.queryEmbedding === null) return hits;
  const q = opts.queryEmbedding;
  const qNorm = l2norm(q);
  if (qNorm === 0) return hits;

  const scored = hits.map((h) => {
    if (!h.embedding) {
      return { hit: h, cosine: 0 };
    }
    const hNorm = l2norm(h.embedding);
    if (hNorm === 0) return { hit: h, cosine: 0 };
    return { hit: h, cosine: dot(q, h.embedding) / (qNorm * hNorm) };
  });

  return scored
    .map(({ hit, cosine }) => ({
      ...hit,
      score: (1 - RERANK_ALPHA) * hit.score + RERANK_ALPHA * cosine
    }))
    .sort((a, b) => b.score - a.score);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function l2norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}
