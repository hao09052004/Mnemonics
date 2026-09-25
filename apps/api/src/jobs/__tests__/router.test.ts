import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createJobRouter } from '../router.js';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const ITEM_A = '00000000-0000-4000-8000-000000000011';
const ITEM_B = '00000000-0000-4000-8000-000000000012';
const JOB_A = '00000000-0000-4000-8000-000000000021';

function createApp(repository: any, jobRow?: any) {
  const pool = {
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM jobs WHERE id = $1')) {
        return { rows: jobRow ? [jobRow] : [], rowCount: jobRow ? 1 : 0 };
      }

      if (sql.includes('INSERT INTO jobs')) {
        const row = {
          id: JOB_A,
          type: params[1],
          item_id: params[2],
          user_id: params[3],
          payload: params[4],
          status: 'pending',
          attempts: 0,
          max_attempts: params[5],
          error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null
        };
        return { rows: [row], rowCount: 1 };
      }

      if (sql.includes('SELECT * FROM jobs') && sql.includes('item_id = $1')) {
        return {
          rows: jobRow ? [jobRow] : [],
          rowCount: jobRow ? 1 : 0
        };
      }

      return { rows: [], rowCount: 0 };
    })
  } as any;

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_A, email: 'user-a@example.com' } },
        error: null
      }))
    }
  } as any;

  const router = createJobRouter({ pool, repository, authSupabase: supabase }).router;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', router);
  return { app, pool };
}

describe('job route authorization', () => {
  it('rejects job status requests without authentication', async () => {
    const { app } = createApp({
      findById: vi.fn()
    });

    const response = await request(app).get('/api/v1/jobs/' + JOB_A);

    expect(response.status).toBe(401);
  });

  it('hides another user job behind JOB_NOT_FOUND', async () => {
    const { app } = createApp({
      findById: vi.fn()
    }, {
      id: JOB_A,
      type: 'tag',
      item_id: ITEM_B,
      user_id: USER_B,
      payload: {},
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null
    });

    const response = await request(app)
      .get('/api/v1/jobs/' + JOB_A)
      .set('Authorization', 'Bearer access-token');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('blocks reading another user item jobs', async () => {
    const repository = {
      findById: vi.fn(async (itemId: string) => itemId === ITEM_B
        ? { id: ITEM_B, userId: USER_B }
        : { id: ITEM_A, userId: USER_A })
    };

    const { app } = createApp(repository);

    const response = await request(app)
      .get('/api/v1/items/' + ITEM_B + '/jobs')
      .set('Authorization', 'Bearer access-token');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('blocks manually triggering jobs for another user item', async () => {
    const repository = {
      findById: vi.fn(async () => ({ id: ITEM_B, userId: USER_B }))
    };

    const { app, pool } = createApp(repository);

    const response = await request(app)
      .post('/api/v1/items/' + ITEM_B + '/jobs/tag')
      .set('Authorization', 'Bearer access-token')
      .send({ reason: 'retry' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ITEM_NOT_FOUND');
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      expect.anything()
    );
  });

  it('allows an authenticated owner to manually create a job', async () => {
    const repository = {
      findById: vi.fn(async () => ({ id: ITEM_A, userId: USER_A }))
    };

    const { app } = createApp(repository);

    const response = await request(app)
      .post('/api/v1/items/' + ITEM_A + '/jobs/tag')
      .set('Authorization', 'Bearer access-token')
      .send({ reason: 'retry' });

    expect(response.status).toBe(201);
    expect(response.body.data.itemId).toBe(ITEM_A);
    expect(response.body.data.userId).toBe(USER_A);
  });
});
