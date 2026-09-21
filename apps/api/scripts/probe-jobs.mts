import { Pool } from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('../../.env', 'utf8');
const m = env.match(/DATABASE_URL=([^\r\n]+)/);
const url = m ? m[1].trim() : '';
console.log('URL prefix:', url.slice(0, 40), 'len:', url.length);

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const t = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    console.log('Tables:', t.rows.map((r) => r.tablename).join(', '));
    const j = await pool.query("SELECT to_regclass('public.jobs') AS jobs");
    console.log('jobs regclass:', j.rows[0].jobs);
    await pool.end();
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
