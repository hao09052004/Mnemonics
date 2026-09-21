import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';

const result = loadEnv({ path: resolve(process.cwd(), '../../../.env') });
console.log('dotenv loaded:', result.parsed ? Object.keys(result.parsed) : 'no parse');
console.log('DATABASE_URL set?', Boolean(process.env.DATABASE_URL));
console.log('DATABASE_URL starts with:', (process.env.DATABASE_URL || '').slice(0, 30));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('=== Tables in public ===');
  const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  for (const row of tables.rows) console.log('  ' + row.tablename);

  console.log('');
  console.log('=== items columns ===');
  const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'items' ORDER BY ordinal_position`);
  for (const row of cols.rows) console.log('  ' + row.column_name + ' (' + row.data_type + ')');

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
