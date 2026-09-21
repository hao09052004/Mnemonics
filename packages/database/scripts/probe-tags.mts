import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT t.id, t.name, t.user_id, it.item_id FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = '0a64b13d-2fdc-4e33-b4ab-7bd2c8e78674'");
console.log('Tags for item:');
for (const row of r.rows) console.log('  ' + JSON.stringify(row));
await pool.end();
