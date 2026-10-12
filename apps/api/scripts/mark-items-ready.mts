/**
 * Force `ready` status on items whose pipeline is stuck.
 *
 * DEBUG-ONLY. Items can get stranded in 'processing' when a job is
 * abandoned; the queue's stale-job reaper normally recovers those on
 * its own. This script is the manual escape hatch, for when the API
 * is not running and you just want the rows visible again.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createPool } from '@mnemonics/database';
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../../.env') });
const pool = createPool(process.env.DATABASE_URL || '');
const dry = process.argv.includes('--dry-run');
console.log(`Mode: ${dry ? 'DRY-RUN' : 'APPLY'}`);
const r = await pool.query("SELECT id, title, status FROM items WHERE status <> 'ready'");
console.log(`Items to update: ${r.rowCount}`);
r.rows.forEach(row => console.log(`  ${row.id.slice(0,8)} ${row.status.padEnd(11)} ${row.title.slice(0,40)}`));
if (!dry && r.rowCount > 0) {
  const upd = await pool.query("UPDATE items SET status = 'ready' WHERE status <> 'ready'");
  console.log(`Updated ${upd.rowCount} rows.`);
}
await pool.end();