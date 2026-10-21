import { describe, expect, it, vi } from 'vitest';
import { runSearch } from '../search-service.js';

describe('search modes contract', () => {
  function makeMockPool() {
    return {
      query: vi.fn(async (sql: string) => {
        if (/FROM\s+items/i.test(sql)) {
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000010',
                type: 'text',
                title: 'Lexical Match Note',
                raw_text: 'keyword search without embeddings',
                ocr_text: null,
                source_url: null,
                captured_at: new Date('2026-09-01T00:00:00Z'),
                score: 0.9
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    } as any;
  }

  it('mode: "lexical" never invokes embedding provider', async () => {
    const embedOneMock = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const mockEmbeddings = {
      info: () => ({ name: 'test-embedder', model: 'test-model', dimensions: 3 }),
      embedOne: embedOneMock,
      embed: vi.fn()
    };
    const pool = makeMockPool();

    const res = await runSearch(
      { pool, embeddings: mockEmbeddings as any },
      '00000000-0000-4000-8000-000000000001',
      { q: 'keyword search', mode: 'lexical' }
    );

    expect(embedOneMock).not.toHaveBeenCalled();
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.explain?.semResults).toBe(0);
    expect(res.explain?.lexResults).toBeGreaterThanOrEqual(1);
  });

  it('mode: "hybrid" invokes embedding provider', async () => {
    const embedOneMock = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const mockEmbeddings = {
      info: () => ({ name: 'test-embedder', model: 'test-model', dimensions: 3 }),
      embedOne: embedOneMock,
      embed: vi.fn()
    };
    const pool = makeMockPool();

    const res = await runSearch(
      { pool, embeddings: mockEmbeddings as any },
      '00000000-0000-4000-8000-000000000001',
      { q: 'hybrid query', mode: 'hybrid' }
    );

    expect(embedOneMock).toHaveBeenCalledTimes(1);
    expect(res.hits.length).toBeGreaterThanOrEqual(1);
  });
});
