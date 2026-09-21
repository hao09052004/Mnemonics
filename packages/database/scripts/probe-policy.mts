import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`SELECT polname, polcmd, polqual, polwithcheck FROM pg_policy WHERE polrelid = 'public.tags'::regclass`);
console.log('Policies on tags:');
for (const row of r.rows) console.log('  ' + JSON.stringify(row, null, 2));
const r2 = await pool.query(`SELECT pg_get_expr(adbin, adrelid) AS expr FROM pg_attrdef WHERE adrelid = 'public.tags'::regclass`);
console.log('\nDefaults:');
for (const row of r2.rows) console.log('  ' + row.expr);
const r3 = await pool.query(`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name='tags' ORDER BY ordinal_position`);
console.log('\nColumns:');
for (const row of r3.rows) console.log('  ' + JSON.stringify(row));
await pool.end();
