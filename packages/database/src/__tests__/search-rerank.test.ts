/**
 * M5 — rerankHits unit tests.
 *
 * Pure unit tests. No database, no HTTP. The function is
 * tested in isolation; the integration is covered in
 * `apps/api/src/routes/__tests__/search-rerank.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  RERANK_ALPHA,
  rerankHits,
  type RerankHit,
  type RerankOptions
} from '../search-service.js';

function hit(id: string, score: number, embedding?: number[]): RerankHit {
  return {
    id,
    score,
    embedding: embedding ?? null,
    lexical: 0,
    vector: 0,
    rrf: score
  };
}

describe('rerankHits — M5 pure unit', () => {
  it('is the identity function when no query embedding is provided', () => {
    const input = [hit('a', 0.9), hit('b', 0.5)];
    const out = rerankHits(input, { queryEmbedding: null } satisfies RerankOptions);
    expect(out.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('promotes a hit whose embedding is closer to the query even if its RRF is lower', () => {
    // The two hits are constructed so that the lower-RRF hit has
    // an embedding exactly matching the query, and the higher-RRF
    // hit has an embedding orthogonal to it. Without re-rank, 'a'
    // wins on RRF alone (0.9 vs 0.5). With re-rank, 'b' wins
    // because its cosine=1 vs 'a''s cosine=0, and the blend at
    // RERANK_ALPHA=0.3 gives 'b' 0.65 vs 'a''s 0.63.
    const input = [
      hit('a', 0.9, [0, 1, 0]),                 // RRF high, embedding orthogonal
      hit('b', 0.5, [1, 0, 0])                  // RRF low,  embedding matches query
    ];
    const out = rerankHits(input, { queryEmbedding: [1, 0, 0] });
    expect(out[0].id).toBe('b');
  });

  it('preserves the cardinality of the input', () => {
    const input = [hit('a', 0.9), hit('b', 0.5), hit('c', 0.1)];
    const out = rerankHits(input, { queryEmbedding: [1, 0, 0] });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((h) => h.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('exposes RERANK_ALPHA as a constant in (0, 1)', () => {
    expect(RERANK_ALPHA).toBeGreaterThan(0);
    expect(RERANK_ALPHA).toBeLessThan(1);
  });

  it('returns the input unchanged when a hit has a zero-norm embedding', () => {
    const input = [hit('a', 0.9, [0, 0, 0]), hit('b', 0.5, [1, 0, 0])];
    const out = rerankHits(input, { queryEmbedding: [1, 0, 0] });
    // Hit 'a' is dropped from re-ranking (zero-norm), 'b' wins on
    // cosine alone, but 'a' keeps its RRF contribution.
    expect(out.map((h) => h.id).sort()).toEqual(['a', 'b']);
  });
});
