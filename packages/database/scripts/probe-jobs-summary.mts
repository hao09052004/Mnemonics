import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT status, COUNT(*)::int AS c FROM jobs GROUP BY status ORDER BY status");
console.log(r.rows);
const recent = await pool.query("SELECT id, type, status, attempts, LEFT(error, 80) AS err FROM jobs ORDER BY created_at DESC LIMIT 10");
console.log('Recent jobs:');
for (const row of recent.rows) console.log('  ' + JSON.stringify(row));
await pool.end();
