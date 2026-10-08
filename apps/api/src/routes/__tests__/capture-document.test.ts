/**
 * `POST /api/v1/captures/document` — multipart document upload.
 *
 * These tests cover the auth boundary, the MIME/extension gate, the
 * size limit, idempotency, the orphan-cleanup-on-DB-failure path,
 * and the success path that returns a durable 201. Storage is the
 * in-memory implementation so the tests don't depend on Supabase.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCaptureRouter } from '../capture.js';
import { createInMemoryImageStorage } from '../../storage.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa';

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

function buildApp(opts?: { repo?: any, createJob?: any }) {
  const repo = opts?.repo ?? {
    findByClientRequestId: vi.fn(async () => null),
    createPendingDocumentItem: vi.fn(async ({ userId, itemId, capture }: any) => ({
      id: itemId,
      userId,
      status: 'pending',
      type: capture.type,
      title: capture.title
    }))
  };
  const createJob = opts?.createJob ?? vi.fn();
  const imageStorage = createInMemoryImageStorage();
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createCaptureRouter({
    repository: repo,
    imageStorage,
    createJob,
    supabase: createSupabaseMock()
  }));
  return { app, repo, createJob, imageStorage };
}

async function buildPdfBuffer(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText(text, { x: 50, y: 750, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe('POST /api/v1/captures/document', () => {
  it('accepts a PDF upload and persists the item + asset', async () => {
    const { app, repo, createJob } = buildApp();
    const bytes = await buildPdfBuffer('Mnemonics document capture integration test.');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Mnemonics test paper')
      .field('clientRequestId', REQUEST_ID)
      .field('capturedAt', '2026-10-06T15:00:00.000Z')
      .attach('file', bytes, { filename: 'paper.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.mimeType).toBe('application/pdf');
    expect(response.body.data.sizeBytes).toBe(bytes.length);
    expect(response.body.data.originalFilename).toBe('paper.pdf');
    expect(response.body.data.signedUrl).toMatch(/^memory:\/\//);
    expect(repo.createPendingDocumentItem).toHaveBeenCalledOnce();
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob).toHaveBeenCalledWith(
      'extract_document',
      expect.any(String),
      USER_ID
    );
  });

  it('accepts a TXT upload', async () => {
    const { app, repo } = buildApp();
    const body = Buffer.from('Mnemonics document capture integration test.\n', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Notes')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(response.status).toBe(201);
    expect(response.body.data.mimeType).toBe('text/plain');
    expect(response.body.data.originalFilename).toBe('notes.txt');
    expect(repo.createPendingDocumentItem).toHaveBeenCalledOnce();
  });

  it('accepts a Markdown upload', async () => {
    const { app } = buildApp();
    const body = Buffer.from('# Heading\n\nbody', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Notes')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'notes.md', contentType: 'text/markdown' });

    expect(response.status).toBe(201);
    expect(response.body.data.mimeType).toBe('text/markdown');
  });

  it('rejects an unsupported MIME', async () => {
    const { app, repo } = buildApp();
    const body = Buffer.from('PK\x03\x04fake-zip', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Bad')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'bad.zip', contentType: 'application/zip' });

    expect(response.status).toBe(415);
    expect(repo.createPendingDocumentItem).not.toHaveBeenCalled();
  });

  it('rejects an oversized file (over 20 MB)', async () => {
    const { app, repo } = buildApp();
    // 21 MiB body. We don't allocate all 21 MiB in tests; a small body
    // that *looks* large to multer via a custom file is more brittle.
    // We use a Buffer of 21 MiB - the in-memory storage carries it.
    const big = Buffer.alloc(21 * 1024 * 1024, 0);
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Big')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(413);
    expect(repo.createPendingDocumentItem).not.toHaveBeenCalled();
  });

  it('rejects when the file field is missing', async () => {
    const { app, repo } = buildApp();
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'No file')
      .field('clientRequestId', REQUEST_ID);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DOCUMENT_FILE_REQUIRED');
    expect(repo.createPendingDocumentItem).not.toHaveBeenCalled();
  });

  it('rejects without an authorization bearer token', async () => {
    const { app, repo } = buildApp();
    const body = Buffer.from('text', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .field('type', 'document')
      .field('title', 'No auth')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'a.txt', contentType: 'text/plain' });

    expect(response.status).toBe(401);
    expect(repo.createPendingDocumentItem).not.toHaveBeenCalled();
  });

  it('is idempotent for a known clientRequestId', async () => {
    const existing = {
      id: '00000000-0000-4000-8000-000000000099',
      userId: USER_ID,
      status: 'processing',
      type: 'document',
      title: 'Already there'
    };
    const repo = {
      findByClientRequestId: vi.fn(async () => existing),
      createPendingDocumentItem: vi.fn()
    };
    const createJob = vi.fn();
    const { app } = buildApp({ repo, createJob });

    const body = Buffer.from('already saved', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Idempotent retry')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'a.txt', contentType: 'text/plain' });

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(existing.id);
    expect(repo.createPendingDocumentItem).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('removes the orphan storage object when the DB insert fails', async () => {
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      // The DB insert throws — the route must catch it and remove the
      // uploaded file so a retry doesn't accumulate orphan objects.
      createPendingDocumentItem: vi.fn(async () => {
        throw new Error('DB_INSERT_FAILED');
      })
    };
    const createJob = vi.fn();
    const imageStorage = createInMemoryImageStorage();
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createCaptureRouter({
      repository: repo,
      imageStorage,
      createJob,
      supabase: createSupabaseMock()
    }));

    const removeSpy = vi.spyOn(imageStorage, 'remove');

    const body = Buffer.from('a doc', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'DB fail')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'a.txt', contentType: 'text/plain' });

    expect(response.status).toBe(500);
    expect(removeSpy).toHaveBeenCalledOnce();
    // The cleanup key must reference the same user/item prefix the
    // route built — that proves the orphan is the one we just uploaded
    // and not some unrelated key.
    const removedKey = removeSpy.mock.calls[0]?.[0] ?? '';
    expect(removedKey).toContain(`${USER_ID}/`);
  });

  it('still returns 201 when the job enqueue fails after a successful DB insert', async () => {
    const repo = {
      findByClientRequestId: vi.fn(async () => null),
      createPendingDocumentItem: vi.fn(async ({ userId, itemId, capture }: any) => ({
        id: itemId,
        userId,
        status: 'pending',
        type: capture.type,
        title: capture.title
      }))
    };
    // The queue.create throws after a successful insert; the route
    // MUST log + keep the item durably accepted.
    const createJob = vi.fn(async () => {
      throw new Error('QUEUE_DOWN');
    });
    const { app } = buildApp({ repo, createJob });

    const body = Buffer.from('Mnemonics document capture integration test.', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Queue down')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, { filename: 'a.txt', contentType: 'text/plain' });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending');
  });

  it('sanitizes dangerous filenames before storing', async () => {
    const { app, imageStorage } = buildApp();
    const body = Buffer.from('hello', 'utf8');
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Traversal attempt')
      .field('clientRequestId', REQUEST_ID)
      .attach('file', body, {
        filename: '../../../etc/passwd',
        contentType: 'text/plain'
      });

    expect(response.status).toBe(201);
    // The storage key must NOT have path traversal characters — we
    // can verify by checking that the signed URL we returned maps to
    // an in-memory key that does not contain `../`.
    const signedUrl: string = response.body.data.signedUrl;
    expect(signedUrl.startsWith('memory://')).toBe(true);
    expect(signedUrl).not.toContain('..');
    expect(signedUrl).not.toContain('/etc/');
  });
});