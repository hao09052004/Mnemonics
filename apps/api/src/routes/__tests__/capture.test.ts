import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createCaptureRouter } from '../capture.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function createSupabaseMock() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: 'test@example.com' } },
        error: null
      }))
    }
  } as any;
}

function createApp(repo: any, createJob = vi.fn()) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createCaptureRouter({
    repository: repo,
    createJob,
    supabase: createSupabaseMock()
  }));
  return { app, createJob };
}

function capturePayload() {
  return {
    type: 'text',
    title: 'Retry queue note',
    selectedText: 'Use idempotency keys when retrying network requests.',
    clientRequestId: '00000000-0000-4000-8000-000000000123'
  };
}

describe('capture route', () => {
  it('creates a pending item and enqueues the first tag job', async () => {
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      createPendingItem: vi.fn(async ({ userId, capture }: any) => ({
        id: '00000000-0000-4000-8000-000000000010',
        userId,
        status: 'pending',
        type: capture.type,
        title: capture.title
      }))
    };

    const { app, createJob } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer access-token')
      .send(capturePayload());

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      data: {
        id: '00000000-0000-4000-8000-000000000010',
        status: 'pending'
      }
    });
    expect(repo.createPendingItem).toHaveBeenCalledWith({
      userId: USER_ID,
      capture: expect.objectContaining({
        clientRequestId: capturePayload().clientRequestId,
        type: 'text'
      })
    });
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledWith(
      'tag',
      '00000000-0000-4000-8000-000000000010',
      USER_ID
    );
  });

  it('is idempotent for an already known client request id', async () => {
    const existing = {
      id: '00000000-0000-4000-8000-000000000010',
      userId: USER_ID,
      status: 'processing',
      type: 'text',
      title: 'Retry queue note'
    };
    const repo = {
      findByClientRequestId: vi.fn(async () => existing),
      createPendingItem: vi.fn()
    };

    const { app, createJob } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer access-token')
      .send(capturePayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        id: existing.id,
        status: existing.status
      }
    });
    expect(repo.createPendingItem).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('rejects captures without a valid bearer token', async () => {
    const repo = {
      findByClientRequestId: vi.fn(),
      createPendingItem: vi.fn()
    };

    const { app, createJob } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .send(capturePayload());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(repo.findByClientRequestId).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });
});
