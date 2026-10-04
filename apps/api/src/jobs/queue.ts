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

import type { Pool } from 'pg';

export type JobType = 'ocr' | 'tag' | 'embed' | 'enrich';
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
 * How long a job may sit in 'processing' before another process assumes the
 * worker holding it died. Generous relative to the 1s poll interval so a
 * slow-but-alive handler (OCR, a cold LLM call) is never stolen mid-flight.
 */
const DEFAULT_STALE_JOB_MS = 5 * 60_000;

/** Minimum gap between two stale-job reaper runs. */
const REAP_INTERVAL_MS = 60_000;

/**
 * JobQueue with EventEmitter for job processing callbacks
 */
export type JobHandler = (job: Job) => Promise<void>;
export type JobFailureHandler = (job: Job, error: string) => Promise<void>;

export class JobQueue {
  private pool: Pool;
  private isProcessing = false;
  private handlers = new Map<JobType, JobHandler>();
  private onTerminalFailure?: JobFailureHandler;
  private processingInterval: NodeJS.Timeout | null = null;
  private lastReapAt = 0;

  constructor(pool: Pool, onTerminalFailure?: JobFailureHandler) {
    this.pool = pool;
    this.onTerminalFailure = onTerminalFailure;
  }

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
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
       ON CONFLICT (item_id, type)
         WHERE status IN ('pending', 'processing')
       DO UPDATE SET updated_at = jobs.updated_at
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
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => this.mapRow(row));
  }

  /**
   * Re-queue jobs that a previous process abandoned mid-flight.
   *
   * `markProcessing` flips a row to 'processing' before the handler runs, so
   * if the process dies (deploy, crash, OOM) the row stays 'processing'
   * forever: `getPendingJobs` only selects 'pending', so the job is never
   * picked up again and its item never advances past `status = 'processing'`.
   * Those items are invisible to search, which requires 'ready'.
   *
   * A row is considered abandoned when it has sat in 'processing' with an
   * unchanged `updated_at` for longer than `staleAfterMs`. Rows that have
   * exhausted `attempts` are marked 'failed' instead of being retried
   * forever. Returns the number of jobs recovered.
   */
  async reapStaleJobs(staleAfterMs: number = DEFAULT_STALE_JOB_MS): Promise<number> {
    const result = await this.pool.query(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           error = CASE WHEN attempts >= max_attempts THEN COALESCE(error, 'reaped: attempts exhausted') ELSE error END,
           updated_at = NOW()
       WHERE status = 'processing'
         AND updated_at < NOW() - ($1 || ' milliseconds')::interval
       RETURNING id`,
      [String(staleAfterMs)]
    );

    return result.rowCount ?? 0;
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
    const result = await this.pool.query<{ total: string; completed: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed
         FROM jobs WHERE item_id = $1`,
      [itemId]
    );
    const row = result.rows[0];
    return Number(row.total) > 0 && Number(row.total) === Number(row.completed);
  }

  /**
   * Process pending jobs (called by interval)
   */
  async processOnce(): Promise<void> {
    await this.processJobs();
  }

  private async processJobs(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.maybeReapStaleJobs();
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
   * Run the stale-job reaper at most once per `REAP_INTERVAL_MS`.
   *
   * The poll loop runs every second; reaping on every tick would mean a
   * needless UPDATE against the jobs table 60x a minute. Reaping is only
   * useful when a worker has actually died, so a minute is plenty.
   */
  private async maybeReapStaleJobs(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReapAt < REAP_INTERVAL_MS) return;
    this.lastReapAt = now;

    try {
      const reaped = await this.reapStaleJobs();
      if (reaped > 0) {
        console.warn(`[JobQueue] Re-queued ${reaped} abandoned job(s) stuck in 'processing'`);
      }
    } catch (error) {
      // A reaper failure must never stop the queue from processing jobs.
      console.error('[JobQueue] Failed to reap stale jobs:', error);
    }
  }

  /**
   * Process a single job - emits event for handlers
   */
  private async processJob(job: Job): Promise<void> {
    const lockedJob = await this.markProcessing(job.id);
    if (!lockedJob) return;

    try {
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error("No handler registered for job type: " + job.type);
      }

      await handler(lockedJob);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[JobQueue] Job ${job.id} failed:`, errorMessage);

      if (lockedJob.attempts >= lockedJob.maxAttempts) {
        await this.markFailed(job.id, errorMessage);
        if (this.onTerminalFailure) {
          await this.onTerminalFailure(lockedJob, errorMessage);
        }
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
