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

describe('capture route — source_metadata (M1)', () => {
  it('persists source_metadata when provided on a text capture', async () => {
    const createPendingItem = vi.fn(async ({ userId, capture, sourceMetadata }: any) => ({
      id: '00000000-0000-4000-8000-000000000020',
      userId,
      status: 'pending',
      type: capture.type,
      title: capture.title
    }));
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      createPendingItem
    };
    const { app } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer access-token')
      .send({
        type: 'text',
        title: 'A note',
        selectedText: 'note body',
        clientRequestId: '00000000-0000-4000-8000-000000000321',
        sourceMetadata: {
          ogTitle: 'Foo',
          jsonLd: [{ '@type': 'Product', material: 'Wood' }],
          article: null,
          contentHash: 'sha256:abc'
        }
      });

    expect(response.status).toBe(201);
    expect(createPendingItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceMetadata: expect.objectContaining({
          ogTitle: 'Foo',
          contentHash: 'sha256:abc'
        })
      })
    );
  });

  it('passes null sourceMetadata when the field is absent', async () => {
    const createPendingItem = vi.fn(async ({ userId, capture, sourceMetadata }: any) => ({
      id: '00000000-0000-4000-8000-000000000021',
      userId,
      status: 'pending',
      type: capture.type,
      title: capture.title
    }));
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      createPendingItem
    };
    const { app } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer access-token')
      .send({
        type: 'text',
        title: 'A note',
        selectedText: 'note body',
        clientRequestId: '00000000-0000-4000-8000-000000000322'
      });

    expect(response.status).toBe(201);
    expect(createPendingItem).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMetadata: null })
    );
  });

  it('rejects sourceMetadata with unknown keys', async () => {
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      createPendingItem: vi.fn(async () => ({}))
    };
    const { app } = createApp(repo);

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer access-token')
      .send({
        type: 'text',
        title: 'A note',
        selectedText: 'note body',
        clientRequestId: '00000000-0000-4000-8000-000000000323',
        sourceMetadata: { unknownKey: 'evil' }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CAPTURE_PAYLOAD');
  });
});
