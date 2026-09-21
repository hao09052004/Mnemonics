import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is missing in env');
  process.exit(1);
}

const wanted = ['007_backend_rls_bypass.sql'];

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  for (const name of wanted) {
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    console.log(`Applying ${name} ...`);
    await pool.query(sql);
    console.log(`  ok`);
  }

  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  console.log('Tables now in public:');
  for (const r of tables.rows) console.log('  ' + r.tablename);
} catch (e) {
  console.error('ERR:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
