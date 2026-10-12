import fs from 'node:fs';
import { Pool } from 'pg';

const envText = fs.readFileSync('c:/mnemonics-csp-fixed/.env', 'utf8');
const lines = envText.split(/\r?\n/);
let databaseUrl = '';
for (const line of lines) {
  if (line.startsWith('DATABASE_URL=')) {
    databaseUrl = line.slice('DATABASE_URL='.length).trim();
    break;
  }
}
if (!databaseUrl) { console.error('DATABASE_URL not found'); process.exit(1); }
console.log('URL starts with:', databaseUrl.slice(0, 50));
console.log('URL length:', databaseUrl.length);

const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const tabs = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    console.log('=== Tables in public ===');
    for (const row of tabs.rows) console.log('  ' + row.tablename);

    console.log('=== items columns ===');
    const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'items' ORDER BY ordinal_position`);
    for (const row of cols.rows) console.log('  ' + row.column_name + ' (' + row.data_type + ')');

    await pool.end();
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
