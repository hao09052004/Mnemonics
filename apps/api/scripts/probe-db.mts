import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';
import { resolve as pathResolve } from 'node:path';

loadEnv({ path: pathResolve(process.cwd(), '../../../.env') });

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }
console.log('URL:', url.slice(0, 50) + '...');

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const tabs = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    console.log('=== Tables in public ===');
    for (const row of tabs.rows) console.log('  ' + row.tablename);

    console.log('');
    console.log('=== items columns ===');
    const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'items' ORDER BY ordinal_position`);
    for (const row of cols.rows) console.log('  ' + row.column_name + ' (' + row.data_type + ')');

    await pool.end();
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
