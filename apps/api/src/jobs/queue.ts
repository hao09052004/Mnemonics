/**
 * Job Queue System for Mnemonics
 *
 * Simple in-memory queue with persistence via database.
 * Jobs are stored in the `jobs` table for reliability.
 *
 * Supports:
 * - OCR jobs (for image/screenshot types)
 * - Tagging jobs (for all types)
 * - Embedding jobs (after tagging completes)
 */

import { EventEmitter } from 'events';
import type { Pool } from 'pg';

export type JobType = 'ocr' | 'tag' | 'embed';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  type: JobType;
  itemId: string;
  userId: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface CreateJobInput {
  type: JobType;
  itemId: string;
  userId: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * JobQueue with EventEmitter for job processing callbacks
 */
export class JobQueue extends EventEmitter {
  private pool: Pool;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  /**
   * Start the job processor
   */
  start(intervalMs = 1000): void {
    if (this.processingInterval) return;
    this.processingInterval = setInterval(() => this.processJobs(), intervalMs);
    console.log('[JobQueue] Started');
  }

  /**
   * Stop the job processor
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('[JobQueue] Stopped');
  }

  /**
   * Create a new job
   */
  async create(input: CreateJobInput): Promise<Job> {
    const { type, itemId, userId, payload = {}, maxAttempts = DEFAULT_MAX_ATTEMPTS } = input;
    const id = crypto.randomUUID();

    const result = await this.pool.query<Job & Record<string, unknown>>(
      `INSERT INTO jobs (id, type, item_id, user_id, payload, max_attempts, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [id, type, itemId, userId, JSON.stringify(payload), maxAttempts]
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get pending jobs for processing
   */
  async getPendingJobs(limit = 10): Promise<Job[]> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND attempts < max_attempts
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    return result.rows.map(row => this.mapRow(row));
  }

  /**
   * Mark a job as processing
   */
  async markProcessing(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `UPDATE jobs
       SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [jobId]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Mark a job as completed
   */
  async markCompleted(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `UPDATE jobs
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [jobId]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Mark a job as failed
   */
  async markFailed(jobId: string, error: string): Promise<Job | null> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `UPDATE jobs
       SET status = 'failed', error = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [jobId, error]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Reset a job to pending for retry
   */
  async resetForRetry(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `UPDATE jobs
       SET status = 'pending', updated_at = NOW()
       WHERE id = $1 AND attempts < max_attempts
       RETURNING *`,
      [jobId]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `SELECT * FROM jobs WHERE id = $1`,
      [jobId]
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Get jobs for an item
   */
  async getJobsForItem(itemId: string): Promise<Job[]> {
    const result = await this.pool.query<Job & Record<string, unknown>>(
      `SELECT * FROM jobs WHERE item_id = $1 ORDER BY created_at ASC`,
      [itemId]
    );

    return result.rows.map(row => this.mapRow(row));
  }

  /**
   * Check if all jobs for an item are completed
   */
  async areAllJobsCompleted(itemId: string): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM jobs
       WHERE item_id = $1 AND status NOT IN ('completed', 'failed')`,
      [itemId]
    );

    return parseInt(result.rows[0].count, 10) === 0;
  }

  /**
   * Process pending jobs (called by interval)
   */
  private async processJobs(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const jobs = await this.getPendingJobs(5);
      for (const job of jobs) {
        await this.processJob(job);
      }
    } catch (error) {
      console.error('[JobQueue] Error processing jobs:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single job - emits event for handlers
   */
  private async processJob(job: Job): Promise<void> {
    const lockedJob = await this.markProcessing(job.id);
    if (!lockedJob) return;

    try {
      // Emit event for registered handlers
      const handler = this.emit(job.type, lockedJob);

      if (!handler) {
        console.warn(`[JobQueue] No handler registered for job type: ${job.type}`);
        await this.markCompleted(job.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[JobQueue] Job ${job.id} failed:`, errorMessage);

      if (lockedJob.attempts >= lockedJob.maxAttempts) {
        await this.markFailed(job.id, errorMessage);
      } else {
        await this.resetForRetry(job.id);
      }
    }
  }

  /**
   * Map database row to Job object
   */
  private mapRow(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      type: row.type as JobType,
      itemId: row.item_id as string,
      userId: row.user_id as string,
      status: row.status as JobStatus,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {}),
      attempts: parseInt(String(row.attempts), 10),
      maxAttempts: parseInt(String(row.max_attempts), 10),
      error: row.error as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined
    };
  }
}
