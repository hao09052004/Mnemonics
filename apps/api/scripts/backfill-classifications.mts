#!/usr/bin/env node
/**
 * Backfill `item_classifications` for items that pre-date the
 * M2 migration (025). Opt-in only.
 *
 *   pnpm tsx apps/api/scripts/backfill-classifications.mts \
 *       --user=<user_id> --limit=200 --dry-run
 *
 *   # Or process every item in the DB:
 *   pnpm tsx apps/api/scripts/backfill-classifications.mts \
 *       --limit=1000 --batch=20
 *
 * What it does:
 *   1. Selects up to `limit` items that have no row in
 *      `item_classifications` yet, ordered by `captured_at`.
 *   2. For each item, enqueues a `classify` job via the same
 *      JobQueue the API uses. The job is the canonical path
 *      (no duplicate code path), so the idempotence key in the
 *      handler will short-circuit if a row already exists by
 *      the time the worker picks the job up.
 *   3. Prints a summary and exits.
 *
 * Safety rails:
 *   - Dry-run mode enqueues no jobs; it only reports the items
 *     it WOULD classify.
 *   - The script refuses to run unless `BACKFILL_CONFIRM=YES`
 *     is set in the environment, to prevent accidental mass
 *     enqueues from CI or a stray shell.
 *   - Limit defaults to 200; batch defaults to 20. Override
 *     with `--limit` and `--batch` flags.
 *
 * This is the only documented path for re-classifying existing
 * items. We do NOT auto-rescore on classifier upgrade
 * (`classifier_version=v1-no-rescore`, spec 0005 §5.4).
 */
import dotenv from 'dotenv';
import { join } from 'node:path';
import { createPool } from '@mnemonics/database';
import { JobQueue } from '../src/jobs/queue.js';

interface Args {
  user: string | null;
  limit: number;
  batch: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let user: string | null = null;
  let limit = 200;
  let batch = 20;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith('--user=')) user = a.slice('--user='.length) || null;
    else if (a === '--all-users') user = null;
    else if (a.startsWith('--limit=')) limit = Math.max(1, Number(a.slice('--limit='.length)) || limit);
    else if (a.startsWith('--batch=')) batch = Math.max(1, Number(a.slice('--batch='.length)) || batch);
    else if (a === '--dry-run') dryRun = true;
  }
  return { user, limit, batch, dryRun };
}

async function main() {
  dotenv.config({ path: join(process.cwd(), '../../.env'), quiet: true });
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set');

  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && process.env.BACKFILL_CONFIRM !== 'YES') {
    console.error('Refusing to run: set BACKFILL_CONFIRM=YES to proceed (or pass --dry-run).');
    process.exit(2);
  }

  const pool = createPool(dbUrl);
  const queue = new JobQueue(pool, undefined, { geminiConcurrency: 0 });

  try {
    const params: unknown[] = [];
    let where = `NOT EXISTS (SELECT 1 FROM item_classifications ic WHERE ic.item_id = i.id)`;
    if (args.user) {
      params.push(args.user);
      where += ` AND i.user_id = $${params.length}`;
    }
    params.push(args.limit);
    const limitParam = params.length;
    const r = await pool.query<{ id: string; user_id: string; captured_at: Date; status: string }>(
      `SELECT i.id, i.user_id, i.captured_at, i.status
         FROM items i
         WHERE ${where}
         ORDER BY i.captured_at ASC
         LIMIT $${limitParam}`,
      params
    );
    const items = r.rows;
    console.log(`[backfill] candidates: ${items.length}${args.dryRun ? ' (dry-run)' : ''}`);

    if (args.dryRun) {
      for (const i of items) {
        console.log(`  would classify: ${i.id}  (user=${i.user_id}, status=${i.status})`);
      }
      return;
    }

    let enqueued = 0;
    let skipped = 0;
    for (let i = 0; i < items.length; i += args.batch) {
      const slice = items.slice(i, i + args.batch);
      await Promise.all(
        slice.map(async (row) => {
          if (row.status === 'failed') {
            skipped += 1;
            return;
          }
          await queue.create({
            type: 'classify',
            itemId: row.id,
            userId: row.user_id,
            payload: { source: 'backfill' }
          });
          enqueued += 1;
        })
      );
      console.log(`[backfill] enqueued ${enqueued} / skipped ${skipped}`);
    }
    console.log(`[backfill] DONE  enqueued=${enqueued} skipped=${skipped}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
