import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CaptureInput } from '@mnemonics/shared';
import type { ItemRepository, NewItem, StoredItem } from '@mnemonics/database';
import { createApp } from './app.js';
import { createCaptureRouter } from './routes/capture.js';
import type { ImageStorage, ImageUpload } from './storage.js';
import { normalizeSupabaseUrl } from './storage.js';

function createFakeRepository(): ItemRepository {
  const items = new Map<string, StoredItem>();
  return {
    async findByClientRequestId(userId, clientRequestId) {
      return items.get(`${userId}:${clientRequestId}`) ?? null;
    },
    async createPendingItem({ userId, capture }: NewItem) {
      const item = { id: crypto.randomUUID(), userId, status: 'pending' as const };
      items.set(`${userId}:${capture.clientRequestId}`, item);
      return item;
    },
    async createPendingImageItem({ userId, capture }) {
      const item = { id: crypto.randomUUID(), userId, status: 'pending' as const };
      items.set(`${userId}:${capture.clientRequestId}`, item);
      return item;
    }
  };
}

function createFakeStorage() {
  const uploads: ImageUpload[] = [];
  const storage: ImageStorage = {
    async upload(input) { uploads.push(input); },
    async remove() {}
  };
  return { storage, uploads };
}

/**
 * Create app with capture router mounted for testing.
 * This mirrors how server.ts sets up the application.
 */
function createTestApp(
  repository: ItemRepository,
  expectedToken?: string,
  imageStorage?: ImageStorage,
  createJob?: (type: 'ocr' | 'tag' | 'embed', itemId: string, userId: string) => Promise<unknown>
) {
  const app = createApp(
    repository,
    expectedToken || 'mnemonics-dev-token',
    '00000000-0000-4000-8000-000000000001',
    imageStorage
  );

  // Mount capture router under /api/v1 (mirrors server.ts)
  app.use('/api/v1', createCaptureRouter({
    repository,
    imageStorage,
    createJob,
    expectedToken: expectedToken || 'mnemonics-dev-token',
    developmentUserId: '00000000-0000-4000-8000-000000000001'
  }));

  return app;
}

const validCapture = {
  type: 'text',
  title: 'Test capture',
  sourceUrl: 'https://example.com/article',
  selectedText: 'Captured text',
  capturedAt: '2026-09-18T09:00:00.000Z',
  clientRequestId: '11111111-1111-4111-8111-111111111111'
} satisfies CaptureInput;

describe('POST /api/v1/captures', () => {
  it('requires bearer authentication', async () => {
    const response = await request(createTestApp(createFakeRepository())).post('/api/v1/captures').send(validCapture);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid payloads', async () => {
    const response = await request(createTestApp(createFakeRepository()))
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send({ ...validCapture, selectedText: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CAPTURE_PAYLOAD');
  });

  it('enqueues tag as the first stage for text captures', async () => {
    const jobs: string[] = [];
    const app = createTestApp(createFakeRepository(), undefined, undefined, async (type) => {
      jobs.push(type);
    });

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send(validCapture);

    expect(response.status).toBe(201);
    expect(jobs).toEqual(['tag']);
  });

  it('enqueues OCR as the first stage for image captures', async () => {
    const jobs: string[] = [];
    const storage = createFakeStorage();
    const app = createTestApp(createFakeRepository(), undefined, storage.storage, async (type) => {
      jobs.push(type);
    });

    const response = await request(app)
      .post('/api/v1/captures/image')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .field('title', 'Pipeline screenshot')
      .field('clientRequestId', '77777777-7777-4777-8777-777777777777')
      .attach('file', Buffer.from('fake-image'), { filename: 'capture.png', contentType: 'image/png' });

    expect(response.status).toBe(201);
    expect(jobs).toEqual(['ocr']);
  });

  it('creates a pending item immediately', async () => {
    const response = await request(createTestApp(createFakeRepository()))
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send(validCapture);
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.id).toEqual(expect.any(String));
  });

  it('returns the existing item for a duplicate client request', async () => {
    const repo = createFakeRepository();
    const app = createTestApp(repo);
    const first = await request(app).post('/api/v1/captures').set('Authorization', 'Bearer mnemonics-dev-token').send(validCapture);
    const second = await request(app).post('/api/v1/captures').set('Authorization', 'Bearer mnemonics-dev-token').send(validCapture);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('rejects image data URLs', async () => {
    const response = await request(createTestApp(createFakeRepository()))
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send({
        type: 'image',
        title: 'Screenshot',
        image: { storageKey: 'data:image/png;base64,abc', mimeType: 'image/png', sizeBytes: 3 },
        clientRequestId: '22222222-2222-4222-8222-222222222222'
      });
    expect(response.status).toBe(400);
  });

  it('deduplicates image uploads by client request id', async () => {
    const fakeStorage = createFakeStorage();
    const app = createTestApp(createFakeRepository(), 'mnemonics-dev-token', fakeStorage.storage);
    const clientRequestId = '66666666-6666-4666-8666-666666666666';

    const first = await request(app)
      .post('/api/v1/captures/image')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .field('title', 'Duplicate image')
      .field('clientRequestId', clientRequestId)
      .attach('file', Buffer.from('fake-image'), { filename: 'capture.png', contentType: 'image/png' });

    const second = await request(app)
      .post('/api/v1/captures/image')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .field('title', 'Duplicate image')
      .field('clientRequestId', clientRequestId)
      .attach('file', Buffer.from('fake-image'), { filename: 'capture.png', contentType: 'image/png' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(fakeStorage.uploads).toHaveLength(1);
  });

  it('uploads an image and creates a pending database item', async () => {
    const fakeStorage = createFakeStorage();
    const response = await request(createTestApp(createFakeRepository(), 'mnemonics-dev-token', fakeStorage.storage))
      .post('/api/v1/captures/image')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .field('title', 'Screenshot test')
      .field('clientRequestId', '55555555-5555-4555-8555-555555555555')
      .attach('file', Buffer.from('fake-image'), { filename: 'capture.png', contentType: 'image/png' });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending');
    expect(fakeStorage.uploads).toHaveLength(1);
    expect(fakeStorage.uploads[0].mimeType).toBe('image/png');
  });
});

describe('Supabase configuration', () => {
  it('normalizes a project URL with a REST path', () => {
    expect(normalizeSupabaseUrl('https://example.supabase.co/rest/v1/')).toBe('https://example.supabase.co/');
  });

  it('rejects a non-HTTP Supabase URL', () => {
    expect(() => normalizeSupabaseUrl('project-key')).toThrow('SUPABASE_URL');
  });
});


describe('local demo authentication', () => {
  it('logs into the deterministic demo account and exposes the demo user', async () => {
    const app = createApp(
      createFakeRepository(),
      'mnemonics-dev-token',
      '00000000-0000-4000-8000-000000000001',
      undefined,
      undefined,
      undefined,
      { demoMode: true }
    );

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'demo@mnemonics.local', password: 'DemoPass123!' });

    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe('demo@mnemonics.local');
    expect(login.body.data.session.accessToken).toBe('mnemonics-dev-token');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer mnemonics-dev-token');

    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects incorrect demo credentials', async () => {
    const app = createApp(
      createFakeRepository(),
      'mnemonics-dev-token',
      '00000000-0000-4000-8000-000000000001',
      undefined,
      undefined,
      undefined,
      { demoMode: true }
    );

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'demo@mnemonics.local', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_LOGIN_FAILED');
  });

  it('refreshes and logs out the deterministic demo session', async () => {
    const app = createApp(
      createFakeRepository(),
      'mnemonics-dev-token',
      '00000000-0000-4000-8000-000000000001',
      undefined,
      undefined,
      undefined,
      { demoMode: true }
    );

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'mnemonics-demo-refresh-token' });

    expect(refresh.status).toBe(200);
    expect(refresh.body.data.session.refreshToken).toBe('mnemonics-demo-refresh-token');

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer mnemonics-dev-token');

    expect(logout.status).toBe(204);
  });
});
