import { config } from 'dotenv';
import { join } from 'path';
import { createPool } from '@mnemonics/database';
config({ path: join(process.cwd(), '.env'), quiet: true });
config({ path: join(process.cwd(), '../../.env'), quiet: true });
const pool = createPool(process.env.DATABASE_URL || '');

const t = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'space%' ORDER BY 1`
);
console.log('space* tables:', t.rows.map((r) => r.table_name));

const cols = await pool.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns WHERE table_name='spaces' ORDER BY ordinal_position`
);
console.log('spaces cols:', cols.rows.map((r) => r.column_name));

const cons = await pool.query<{ conname: string; pg_get_constraintdef: string }>(
  `SELECT conname, pg_get_constraintdef(oid) AS pg_get_constraintdef
   FROM pg_constraint WHERE conrelid = 'spaces'::regclass`
);
console.log('spaces constraints:');
cons.rows.forEach((r) => console.log(`  ${r.conname}: ${r.pg_get_constraintdef}`));

const trig = await pool.query<{ tgname: string }>(
  `SELECT tgname FROM pg_trigger WHERE tgrelid IN ('spaces'::regclass,'space_items'::regclass) AND NOT tgisinternal`
);
console.log('triggers:', trig.rows.map((r) => r.tgname));

// Behavioural check: a smart space must refuse manual membership.
const u = await pool.query<{ id: string }>(
  `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at)
   VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000',$1,'',NOW(),'authenticated','authenticated',NOW(),NOW())
   RETURNING id`,
  [`verify-${Date.now()}@example.com`]
);
const uid = String(u.rows[0].id);
const s = await pool.query<{ id: string }>(
  `INSERT INTO spaces (user_id, name, space_type, rule) VALUES ($1,'S','smart','{"q":"x"}'::jsonb) RETURNING id`,
  [uid]
);
const it = await pool.query<{ id: string }>(
  `INSERT INTO items (user_id, type, title, captured_at, status, client_request_id)
   VALUES ($1,'text','t',NOW(),'ready',gen_random_uuid()) RETURNING id`,
  [uid]
);
try {
  await pool.query('INSERT INTO space_items (space_id, item_id) VALUES ($1,$2)', [s.rows[0].id, it.rows[0].id]);
  console.log('SMART-MEMBERSHIP GUARD: FAILED (insert was allowed)');
} catch (e) {
  console.log('SMART-MEMBERSHIP GUARD: OK —', (e as Error).message.slice(0, 90));
}
try {
  await pool.query(`INSERT INTO spaces (user_id,name,space_type,color) VALUES ($1,'N','manual','#ff00ff')`, [uid]);
  console.log('COLOR GUARD: FAILED (neon accepted)');
} catch (e) {
  console.log('COLOR GUARD: OK —', (e as Error).message.slice(0, 70));
}
await pool.query('DELETE FROM spaces WHERE user_id=$1', [uid]);
await pool.query('DELETE FROM items WHERE user_id=$1', [uid]);
await pool.query('DELETE FROM auth.users WHERE id=$1', [uid]);
await pool.end();
