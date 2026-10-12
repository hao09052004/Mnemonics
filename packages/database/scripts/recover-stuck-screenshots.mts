/**
 * One-shot recovery: re-enqueue the OCR job for the two
 * screenshots that are stuck in `processing` because the OCR
 * provider threw a PROVIDER_UNAVAILABLE error.
 *
 * Steps:
 *  1. Set the affected items back to status=pending.
 *  2. Mark any in-flight `ocr` job for those items as failed
 *     with a tagged error so the queue does not pick them up
 *     again.
 *  3. Insert a fresh `ocr` job so the worker reprocesses them
 *     with the now-installed tesseract.js fallback.
 */
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

function loadEnv(): void {
  const candidates = ["../../../.env", "../../.env", "../.env", ".env"];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const text = readFileSync(c, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return;
  }
}
loadEnv();

const itemIds = process.argv.slice(2);
if (itemIds.length === 0) {
  console.error("usage: tsx scripts/recover-stuck-screenshots.mts <item-id> [item-id ...]");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const itemId of itemIds) {
    console.log(`\n[recover] item ${itemId}`);
    const it = await client.query<{ type: string; status: string; user_id: string }>(
      `SELECT type, status, user_id FROM items WHERE id = $1`,
      [itemId]
    );
    if (it.rowCount === 0) {
      console.log(`  NOT FOUND, skipping`);
      continue;
    }
    const row = it.rows[0];
    console.log(`  type=${row.type}  status=${row.status}  user_id=${row.user_id}`);
    if (row.status !== "processing") {
      console.log(`  status is not 'processing' (it is '${row.status}'); leaving alone`);
      continue;
    }

    await client.query("BEGIN");
    try {
      // 1. reset item status
      await client.query(
        `UPDATE items SET status='pending', updated_at=NOW() WHERE id=$1`,
        [itemId]
      );
      // 2. fail any in-flight ocr job for this item
      const fail = await client.query<{ id: string }>(
        `UPDATE jobs
            SET status='failed',
                error=COALESCE(error,'') ||
                  E'\n[recovery] reset after PROVIDER_UNAVAILABLE fix on ' || NOW()::text,
                updated_at=NOW()
          WHERE item_id=$1 AND type='ocr' AND status IN ('processing','pending')
          RETURNING id`,
        [itemId]
      );
      console.log(`  failed ocr jobs: ${fail.rowCount}`);
      // 3. insert a fresh ocr job
      const ins = await client.query<{ id: string }>(
        `INSERT INTO jobs (type, item_id, user_id, status, payload, attempts, max_attempts)
         VALUES ('ocr', $1, $2, 'pending', '{}'::jsonb, 0, 3)
         RETURNING id`,
        [itemId, row.user_id]
      );
      console.log(`  inserted new ocr job: ${ins.rows[0].id}`);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
} finally {
  await client.end();
}
