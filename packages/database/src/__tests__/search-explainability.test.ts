/**
 * M7 — buildSearchHitExplanation unit tests.
 *
 * Pure unit tests. The module is tested in isolation;
 * the integration with `runSearch` is in
 * `apps/api/src/routes/__tests__/search-rerank.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSearchHitExplanation,
  type SearchHitExplanationInput
} from '../search-explainability.js';

function input(overrides: Partial<SearchHitExplanationInput> = {}): SearchHitExplanationInput {
  return {
    lexical: 0,
    vector: 0,
    chunk: 0,
    rrf: 0,
    rerank: null,
    rerankEnabled: false,
    ...overrides
  };
}

describe('buildSearchHitExplanation — M7 pure unit', () => {
  it('returns null when explainability is off', () => {
    expect(buildSearchHitExplanation(input({ rerankEnabled: false }))).toBeNull();
  });

  it('returns a populated block when explainability is on', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.5,
      vector: 0.7,
      chunk: 0.6,
      rrf: 0.4,
      rerank: 0.65,
      rerankEnabled: true
    }));
    expect(out).toEqual({
      lexical: 0.5,
      vector: 0.7,
      chunk: 0.6,
      rrf: 0.4,
      rerank: 0.65
    });
  });

  it('keeps rerank as null when re-rank was off, even if explainability is on', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.5,
      vector: 0.7,
      rrf: 0.4,
      rerankEnabled: false
    }));
    expect(out).toBeNull();
  });

  it('rounds each numeric field to 4 decimal places', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.123456789,
      rrf: 0.987654321,
      rerank: 0.555555555,
      rerankEnabled: true
    }));
    expect(out).toEqual({
      lexical: 0.1235,
      vector: 0,
      chunk: 0,
      rrf: 0.9877,
      rerank: 0.5556
    });
  });
});
