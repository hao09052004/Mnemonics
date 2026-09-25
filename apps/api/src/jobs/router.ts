/**
 * Job Queue Router
 *
 * Mounts job-related endpoints and registers job handlers.
 */

import express, { type Application } from 'express';
import type { Pool } from 'pg';
import { JobQueue } from './queue.js';
import { OcrHandler } from './handlers/ocr.js';
import { TagHandler } from './handlers/tag.js';
import { EmbedHandler } from './handlers/embed.js';
import type { ItemRepository } from '@mnemonics/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from '../auth.js';

export interface JobRouterDeps {
  pool: Pool;
  repository: ItemRepository;
  supabase?: SupabaseClient;
  authSupabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
  openAiKey?: string;
}

export function createJobRouter(deps: JobRouterDeps): {
  queue: JobQueue;
  router: Application;
} {
  const {
    pool,
    repository,
    supabase,
    authSupabase,
    expectedToken = 'mnemonics-dev-token',
    developmentUserId = '00000000-0000-4000-8000-000000000001',
    openAiKey
  } = deps;

  // Create queue
  const queue = new JobQueue(pool, async (job) => {
    await repository.updateStatus(job.itemId, 'failed');
  });

  // Create handlers
  const ocrHandler = new OcrHandler(queue, repository, openAiKey);
  const tagHandler = new TagHandler(queue, repository, openAiKey);
  const embedHandler = new EmbedHandler(queue, repository, supabase, openAiKey, pool);

  // Register job handlers using EventEmitter
  queue.registerHandler('ocr', (job) => ocrHandler.handle(job));
  queue.registerHandler('tag', (job) => tagHandler.handle(job));
  queue.registerHandler('embed', (job) => embedHandler.handle(job));

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
    const validTypes = ['ocr', 'tag', 'embed'];

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
      type: type as 'ocr' | 'tag' | 'embed',
      itemId,
      userId: item.userId,
      payload: req.body || {}
    });

    res.status(201).json({ data: job });
  });

  return { queue, router };
}
