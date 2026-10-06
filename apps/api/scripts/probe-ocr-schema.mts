/**
 * Probe the items table to confirm:
 *  - items_type_check accepts 'screenshot'
 *  - items ocr_language, ocr_processed_at, ocr_error_code columns exist
 *  - public.ocr_quota table exists
 *
 * Used as a CI gate (run before booting the API) to make sure
 * migrations 008_relax_item_type_check.sql and
 * 012_ocr_metadata_and_quota.sql have been applied to the target
 * database. Without 008 the OCR pipeline fails with
 * "new row for relation 'items' violates check constraint
 * 'items_type_check'" the first time an extension screenshot is
 * saved.
 */

import { createPool } from '@mnemonics/database';
import { config as loadEnv } from 'dotenv';
import { resolve as pathResolve } from 'node:path';

loadEnv({ path: pathResolve(process.cwd(), '..', '..', '..', '.env') });
loadEnv({ path: pathResolve(process.cwd(), '.env') });
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing; cannot probe schema');
  process.exit(2);
}

const pool = createPool(process.env.DATABASE_URL);

const failures: string[] = [];

async function check(): Promise<void> {
  const c = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'items'::regclass AND contype = 'c' AND conname = 'items_type_check'`
  );
  const def: string = c.rows[0]?.def ?? '';
  console.log(`items_type_check: ${def || '(missing)'}`);
  if (!def.includes("'screenshot'")) {
    failures.push("items_type_check does NOT include 'screenshot'. Apply packages/database/migrations/008_relax_item_type_check.sql");
  }

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'items' AND column_name IN ('ocr_language', 'ocr_processed_at', 'ocr_error_code')`
  );
  const present = cols.rows.map((r) => r.column_name).sort();
  console.log(`items ocr columns: ${present.join(', ') || '(none)'}`);
  for (const needed of ['ocr_language', 'ocr_processed_at', 'ocr_error_code']) {
    if (!present.includes(needed)) {
      failures.push(`items.${needed} is missing. Apply packages/database/migrations/012_ocr_metadata_and_quota.sql`);
    }
  }

  const q = await pool.query(`SELECT to_regclass('public.ocr_quota') AS present`);
  console.log(`ocr_quota: ${q.rows[0]?.present ?? '(missing)'}`);
  if (!q.rows[0]?.present) {
    failures.push("public.ocr_quota is missing. Apply packages/database/migrations/012_ocr_metadata_and_quota.sql");
  }
}

try {
  await check();
} catch (e) {
  console.error('probe-ocr-schema ERR:', e instanceof Error ? e.message : e);
  process.exit(2);
} finally {
  await pool.end();
}

if (failures.length > 0) {
  console.error('\n❌ OCR schema probe failed:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✅ OCR schema probe passed');