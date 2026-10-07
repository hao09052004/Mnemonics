/**
 * Cluster refresh job handler.
 *
 * Recomputes the user's content clusters after a new embedding
 * lands. The job is enqueued by the embed handler once an item
 * transitions to `ready`; the actual work is the same
 * `ClusterRepository.refresh()` the route layer also calls.
 *
 * One user can have many `cluster_refresh` jobs in flight at once
 * (the queue is shared across users, but each job is single-user).
 * The repo's `refresh` is idempotent — it drops the user's existing
 * rows and rewrites them in one transaction — so concurrent
 * refreshes for the same user simply race and the last one wins.
 * That is acceptable: the result is always the current corpus, and
 * stale intermediate results are not exposed because the read API
 * reads the committed rows.
 */

import type { Pool } from 'pg';
import { createClusterRepository } from '@mnemonics/database';

export interface ClusterRefreshHandlerDeps {
  pool: Pool;
}

export class ClusterRefreshHandler {
  constructor(private readonly deps: ClusterRefreshHandlerDeps) {}

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    // The job row carries the userId of the user whose clusters we
    // should recompute. The `itemId` is the just-embedded item that
    // triggered the refresh; it is informational here.
    if (!job.userId) {
      throw new Error('cluster_refresh job is missing userId');
    }
    const startedAt = Date.now();
    const repo = createClusterRepository();
    const result = await repo.refresh(job.userId, { pool: this.deps.pool });
    const durationMs = Date.now() - startedAt;
    // The log line is intentionally minimal: no corpus content,
    // no vector data, no user-supplied text. The user_id is the
    // one piece of context that is useful for debugging; the rest
    // is counts and the algorithm version (spec §61).
    console.log(
      `[ClusterRefreshHandler] user=${job.userId} clusters=${result.clusterCount} ` +
        `unclustered=${result.unclusteredCount} eligible=${result.eligibleItemCount} ` +
        `durationMs=${durationMs}`
    );
  }
}
