/**
 * M7 — search result explainability.
 *
 * Pure builder. Given the per-leg scores tracked through
 * `runSearch`, returns a flat `SearchHitExplanation`
 * object that the dashboard can render as a "Why this
 * matched" pill.
 *
 * Returns `null` when `rerankEnabled` is false. The
 * response only carries the block when explainability is
 * turned on at the API.
 */

export interface SearchHitExplanation {
  lexical: number;
  vector: number;
  chunk: number;
  rrf: number;
  rerank: number | null;
}

export interface SearchHitExplanationInput {
  lexical: number;
  vector: number;
  chunk: number;
  rrf: number;
  rerank: number | null;
  /** True when SEARCH_EXPLAINABILITY_ENABLED is on. The
   *  builder only returns a populated block when this is
   *  true. */
  rerankEnabled: boolean;
}

const ROUND = 10_000;

function r4(n: number): number {
  return Math.round(n * ROUND) / ROUND;
}

export function buildSearchHitExplanation(
  input: SearchHitExplanationInput
): SearchHitExplanation | null {
  if (!input.rerankEnabled) return null;
  return {
    lexical: r4(input.lexical),
    vector: r4(input.vector),
    chunk: r4(input.chunk),
    rrf: r4(input.rrf),
    rerank: input.rerank === null ? null : r4(input.rerank)
  };
}
