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

export interface JobRouterDeps {
  pool: Pool;
  repository: ItemRepository;
  supabase?: SupabaseClient;
  openAiKey?: string;
}

export function createJobRouter(deps: JobRouterDeps): {
  queue: JobQueue;
  router: Application;
} {
  const { pool, repository, supabase, openAiKey } = deps;

  // Create queue
  const queue = new JobQueue(pool);

  // Create handlers
  const ocrHandler = new OcrHandler(queue, repository, openAiKey);
  const tagHandler = new TagHandler(queue, repository, openAiKey);
  const embedHandler = new EmbedHandler(queue, repository, supabase, openAiKey);

  // Register job handlers using EventEmitter
  queue.on('ocr', async (job: unknown) => {
    await ocrHandler.handle(job as Parameters<typeof ocrHandler.handle>[0]);
  });
  queue.on('tag', async (job: unknown) => {
    await tagHandler.handle(job as Parameters<typeof tagHandler.handle>[0]);
  });
  queue.on('embed', async (job: unknown) => {
    await embedHandler.handle(job as Parameters<typeof embedHandler.handle>[0]);
  });

  // Create router
  const router = express.Router() as Application;

  // Health check
  router.get('/jobs/health', (_req: unknown, res: { json: (data: unknown) => void }) => {
    res.json({ data: { status: 'ok', queue: 'running' } });
  });

  // Get job status
  router.get('/jobs/:id', async (req: { params: { id: string } }, res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }) => {
    const job = await queue.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } });
      return;
    }
    res.json({ data: job });
  });

  // Get jobs for item
  router.get('/items/:itemId/jobs', async (req: { params: { itemId: string } }, res: { json: (data: unknown) => void }) => {
    const jobs = await queue.getJobsForItem(req.params.itemId);
    res.json({ data: jobs });
  });

  // Manually trigger a job (for retry/debugging)
  router.post('/items/:itemId/jobs/:type', async (
    req: { params: { itemId: string; type: string }; body: Record<string, unknown> },
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
    if (!item) {
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
