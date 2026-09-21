// Probe database: list all tables in public schema and check critical columns
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('=== Tables in public ===');
  const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  for (const row of tables.rows) console.log('  ' + row.tablename);

  console.log('');
  console.log('=== items table columns ===');
  const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'items' ORDER BY ordinal_position`);
  for (const row of cols.rows) console.log('  ' + row.column_name + ' (' + row.data_type + ')');

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
