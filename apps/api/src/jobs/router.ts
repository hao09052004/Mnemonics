/**
 * Job Queue Router
 *
 * Mounts job-related endpoints and registers job handlers.
 */

import express, { type Application } from 'express';
import type { Pool } from 'pg';
import { JobQueue } from './queue.js';
import { OcrHandler, makeOcrStorageKeyResolver } from './handlers/ocr.js';
import { TagHandler } from './handlers/tag.js';
import { EmbedHandler } from './handlers/embed.js';
import { UnderstandingHandler } from './handlers/enrich.js';
import { ExtractDocumentHandler } from './handlers/extract-document.js';
import type { ItemRepository, SpaceRepository, EnrichmentRepository } from '@mnemonics/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageStorage } from '../storage.js';
import type { AiService } from '@mnemonics/ai';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';

export interface JobRouterDeps {
  pool: Pool;
  repository: ItemRepository;
  spaceRepository?: SpaceRepository;
  enrichmentRepository?: EnrichmentRepository;
  supabase?: SupabaseClient;
  authSupabase?: SupabaseClient;
  imageStorage: ImageStorage;
  ai: AiService;
  expectedToken?: string;
  developmentUserId?: string;
}

export function createJobRouter(deps: JobRouterDeps): {
  queue: JobQueue;
  router: Application;
} {
  const {
    pool,
    repository,
    spaceRepository,
    enrichmentRepository,
    supabase,
    authSupabase,
    imageStorage,
    ai,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001'
  } = deps;

  // Create queue
  const queue = new JobQueue(pool, async (job) => {
    await repository.updateStatus(job.itemId, 'failed');
  });

  // Create handlers
  const ocrHandler = new OcrHandler({
    queue,
    repository,
    imageStorage,
    ai,
    resolveAssetKey: makeOcrStorageKeyResolver(pool),
  });
  const tagHandler = new TagHandler({ queue, repository, ai });
  const embedHandler = new EmbedHandler({
    queue,
    repository,
    ai,
    supabase,
    pool,
  });
  const enrichmentHandler = enrichmentRepository
    ? new UnderstandingHandler({
        queue,
        enrichments: enrichmentRepository,
        imageStorage,
        ai,
        pool
      })
    : null;

  const extractDocumentHandler = new ExtractDocumentHandler({
    queue,
    repository,
    storage: imageStorage,
    pool
  });

  // Register job handlers using EventEmitter
  queue.registerHandler('ocr', (job) => ocrHandler.handle(job));
  queue.registerHandler('tag', (job) => tagHandler.handle(job));
  queue.registerHandler('embed', (job) => embedHandler.handle(job));
  if (enrichmentHandler) {
    queue.registerHandler('enrich', (job) => enrichmentHandler.handle(job as unknown as { id: string; itemId: string; userId: string; payload: Record<string, unknown> }));
  }
  queue.registerHandler('extract_document', (job) => extractDocumentHandler.handle(job));

  // Create router
  const router = express.Router() as Application;

  // Health check
  router.get('/jobs/health', (_req: unknown, res: { json: (data: unknown) => void }) => {
    res.json({ data: { status: 'ok', queue: 'running' } });
  });

  const authMiddleware = authSupabase
    ? requireSupabaseAuth(authSupabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  // Get job status
  router.get('/jobs/:id', authMiddleware, async (req: AuthenticatedRequest & { params: { id: string } }, res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }) => {
    const job = await queue.getJob(req.params.id);
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } });
      return;
    }
    res.json({ data: job });
  });

  // Get jobs for item
  router.get('/items/:itemId/jobs', authMiddleware, async (req: AuthenticatedRequest & { params: { itemId: string } }, res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }) => {
    const item = await repository.findById(req.params.itemId);
    if (!item || item.userId !== req.userId) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
      return;
    }
    const jobs = await queue.getJobsForItem(req.params.itemId);
    res.json({ data: jobs });
  });

  // Manually trigger a job (for retry/debugging)
  router.post('/items/:itemId/jobs/:type', authMiddleware, async (
    req: AuthenticatedRequest & { params: { itemId: string; type: string }; body: Record<string, unknown> },
    res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }
  ) => {
    const { itemId, type } = req.params;
    const validTypes = ['ocr', 'tag', 'embed', 'enrich', 'extract_document'];

    if (!validTypes.includes(type)) {
      res.status(400).json({ error: { code: 'INVALID_JOB_TYPE', message: `Job type must be one of: ${validTypes.join(', ')}` } });
      return;
    }

    // Get item to find user_id
    const item = await repository.findById(itemId);
    if (!item || item.userId !== req.userId) {
      res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
      return;
    }

    const job = await queue.create({
      type: type as 'ocr' | 'tag' | 'embed' | 'enrich' | 'extract_document',
      itemId,
      userId: item.userId,
      payload: req.body || {}
    });

    res.status(201).json({ data: job });
  });

  return { queue, router };
}
