import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
console.log('Tables RLS:');
for (const row of r.rows) console.log('  ' + JSON.stringify(row));

const r2 = await pool.query("SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename");
console.log('\nPolicies:');
for (const row of r2.rows) console.log('  ' + JSON.stringify(row));

// Simulate updateTags: get user_id for item 0a64b13d
const r3 = await pool.query("SELECT user_id FROM items WHERE id = '0a64b13d-2fdc-4e33-b4ab-7bd2c8e78674'");
console.log('\nLookup user_id:', r3.rows[0]);

await pool.end();
