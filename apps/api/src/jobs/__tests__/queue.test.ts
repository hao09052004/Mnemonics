/**
 * Job Queue Tests
 *
 * Tests for the background job processing system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobQueue, type CreateJobInput } from '../queue.js';

describe('JobQueue', () => {
  let queue: JobQueue;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: async (sql: string, params: any[]) => {
        // Simple mock for testing
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
    expect(job.attempts).toBe(0);
  });

  it('should emit events for job types', async () => {
    let received = false;

    queue.on('tag', async () => {
      received = true;
    });

    queue.emit('tag', { id: 'job-1', itemId: 'item-1', userId: 'user-1', payload: {} });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(received).toBe(true);
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
