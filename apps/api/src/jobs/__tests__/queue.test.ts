/**
 * Job Queue Tests
 *
 * Tests for the background job processing system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobQueue, type CreateJobInput, type Job } from '../queue.js';

describe('JobQueue', () => {
  let queue: JobQueue;
  let mockPool: any;
  let nextId: string;
  let nextAttempts: number;
  let nextMaxAttempts: number;

  beforeEach(() => {
    nextId = '';
    nextAttempts = 0;
    nextMaxAttempts = 3;
    mockPool = {
      query: async (sql: string, params: any[]) => {
        // Mock for INSERT/UPDATE/SELECT that returns RETURNING *
        if (sql.trim().toUpperCase().startsWith('INSERT')) {
          // Capture the generated ID from the first param (queue.create passes id first)
          nextId = params[0];
          nextMaxAttempts = params[5] || 3;
          nextAttempts = 0;
          const row = {
            id: nextId,
            type: params[1],
            item_id: params[2],
            user_id: params[3],
            payload: params[4],
            status: 'pending',
            attempts: nextAttempts,
            max_attempts: nextMaxAttempts,
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null
          };
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    };
    queue = new JobQueue(mockPool);
  });

  afterEach(() => {
    queue.stop();
  });

  it('should create a job', async () => {
    const input: CreateJobInput = {
      type: 'tag',
      itemId: 'item-123',
      userId: 'user-456'
    };

    const job = await queue.create(input);
    expect(job).toBeDefined();
    expect(job.id).toEqual(expect.any(String));
    expect(job.type).toBe('tag');
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
  });

  it('should register async handlers without EventEmitter coupling', async () => {
    const handler = async (_job: Job) => undefined;
    queue.registerHandler('tag', handler);
    expect((queue as any).handlers.get('tag')).toBe(handler);
  });


  it('awaits handlers and retries transient failures', async () => {
    let attempts = 0;
    let status = 'pending';
    let dbJob = {
      id: 'job-retry',
      type: 'tag',
      item_id: 'item-1',
      user_id: 'user-1',
      payload: {},
      status,
      attempts: 0,
      max_attempts: 2,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null
    };

    const pool = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes('WHERE status = \'pending\'')) {
          return { rows: status === 'pending' ? [dbJob] : [], rowCount: status === 'pending' ? 1 : 0 };
        }
        if (sql.includes('SET status = \'processing\'')) {
          status = 'processing';
          dbJob = { ...dbJob, status, attempts: dbJob.attempts + 1 };
          return { rows: [dbJob], rowCount: 1 };
        }
        if (sql.includes('SET status = \'pending\'')) {
          status = 'pending';
          dbJob = { ...dbJob, status };
          return { rows: [dbJob], rowCount: 1 };
        }
        if (sql.includes('SET status = \'completed\'')) {
          status = 'completed';
          dbJob = { ...dbJob, status };
          return { rows: [dbJob], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    } as any;

    const retryQueue = new JobQueue(pool);
    retryQueue.registerHandler('tag', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
      await retryQueue.markCompleted('job-retry');
    });

    await retryQueue.processOnce();
    expect(attempts).toBe(1);
    expect(status).toBe('pending');

    await retryQueue.processOnce();
    expect(attempts).toBe(2);
    expect(status).toBe('completed');
    retryQueue.stop();
  });

  it('should track max attempts', async () => {
    const job = await queue.create({
      type: 'embed',
      itemId: 'item-789',
      userId: 'user-123',
      maxAttempts: 5
    });

    expect(job.maxAttempts).toBe(5);
  });
});
