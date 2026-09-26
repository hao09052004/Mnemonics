import { describe, expect, it, vi } from 'vitest';
import { autoLinkSimilarItems } from '../auto-link-similar.js';

describe('autoLinkSimilarItems', () => {
  it('creates bidirectional similar edges above the threshold', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });

        if (sql.includes('FROM item_embeddings source_embedding')) {
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000002',
                similarity: 0.91
              },
              {
                id: '00000000-0000-4000-8000-000000000003',
                similarity: 0.83
              }
            ],
            rowCount: 2
          };
        }

        return { rows: [], rowCount: 2 };
      })
    } as any;

    const result = await autoLinkSimilarItems(
      pool,
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010',
      { threshold: 0.8, limit: 5 }
    );

    expect(result).toEqual([
      { id: '00000000-0000-4000-8000-000000000002', similarity: 0.91 },
      { id: '00000000-0000-4000-8000-000000000003', similarity: 0.83 }
    ]);
    expect(pool.query).toHaveBeenCalledTimes(3);

    const insert = queries[1];
    expect(insert.sql).toContain("VALUES");
    expect(insert.params.slice(0, 4)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000002',
      0.91
    ]);
    expect(JSON.parse(String(insert.params[4]))).toMatchObject({
      source: 'embedding',
      model: 'text-embedding-3-small',
      threshold: 0.8
    });
  });

  it('returns no links when there are no sufficiently similar ready memories', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    } as any;

    const result = await autoLinkSimilarItems(
      pool,
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010'
    );

    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
