import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createGraphRouter } from '../graph.js';

function createSupabaseMock(user = { id: '00000000-0000-4000-8000-000000000001' }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: null
      }))
    }
  } as any;
}

function createGraphApp(pool: any, user = { id: '00000000-0000-4000-8000-000000000001' }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createGraphRouter({ pool, supabase: createSupabaseMock(user) }));
  return app;
}

describe('graph routes', () => {
  it('creates an edge only when both items belong to the authenticated user', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });

        if (sql.includes('SELECT COUNT(*) as count FROM items')) {
          return { rows: [{ count: '2' }], rowCount: 1 };
        }

        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000010',
            user_id: params[0],
            from_item_id: params[1],
            to_item_id: params[2],
            edge_type: params[3],
            weight: params[4],
            attributes: {}
          }],
          rowCount: 1
        };
      }
    };

    const app = createGraphApp(pool);
    const response = await request(app)
      .post('/api/v1/items/00000000-0000-4000-8000-000000000011/edges')
      .set('Authorization', 'Bearer valid')
      .send({
        to_item_id: '00000000-0000-4000-8000-000000000012',
        edge_type: 'related',
        weight: 0.8
      });

    expect(response.status).toBe(201);
    expect(response.body.data.edge_type).toBe('related');
    expect(queries[0].params).toEqual([
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000001'
    ]);
  });

  it('rejects invalid related-item limits before querying the database', async () => {
    const pool = {
      query: vi.fn()
    };

    const app = createGraphApp(pool);
    const response = await request(app)
      .get('/api/v1/items/00000000-0000-4000-8000-000000000011/related?limit=0')
      .set('Authorization', 'Bearer valid');

    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns related items with normalized similarity scores', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{
          id: '00000000-0000-4000-8000-000000000012',
          type: 'text',
          title: 'Related note',
          captured_at: '2026-09-25T00:00:00.000Z',
          similarity: '0.8125'
        }],
        rowCount: 1
      }))
    };

    const app = createGraphApp(pool);
    const response = await request(app)
      .get('/api/v1/items/00000000-0000-4000-8000-000000000011/related?limit=5')
      .set('Authorization', 'Bearer valid');

    expect(response.status).toBe(200);
    expect(response.body.related_items).toEqual([{
      id: '00000000-0000-4000-8000-000000000012',
      type: 'text',
      title: 'Related note',
      captured_at: '2026-09-25T00:00:00.000Z',
      similarity: 0.8125
    }]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY ie1.embedding <=> ie2.embedding'),
      ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 5]
    );
  });

  it('reports graph stats for only the authenticated user', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            total_edges: '4',
            connected_from_count: '3',
            connected_to_count: '2',
            edge_type_count: '2'
          }]
        })
        .mockResolvedValueOnce({
          rows: [
            { edge_type: 'related', count: '3' },
            { edge_type: 'references', count: '1' }
          ]
        })
    };

    const app = createGraphApp(pool);
    const response = await request(app)
      .get('/api/v1/graph/stats')
      .set('Authorization', 'Bearer valid');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      stats: {
        total_edges: 4,
        connected_from_count: 3,
        connected_to_count: 2,
        edge_type_count: 2
      },
      edges_by_type: [
        { type: 'related', count: 3 },
        { type: 'references', count: 1 }
      ]
    });
    expect(pool.query.mock.calls[0][1]).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(pool.query.mock.calls[1][1]).toEqual(['00000000-0000-4000-8000-000000000001']);
  });
});
