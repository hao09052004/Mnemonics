import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const r = await client.query("SELECT current_user, current_setting('request.jwt.claim.sub', true) AS jwt_sub, current_setting('is_superuser', true) AS is_super");
  console.log('Session:', r.rows[0]);
  const r2 = await client.query("SELECT is_backend_session() AS be");
  console.log('is_backend:', r2.rows[0]);

  // Direct insert with explicit UUID
  const userId = 'b78f5f3a-f94c-44bc-92e3-b71ef91adddd';
  console.log('userId typeof=', typeof userId, 'value=', JSON.stringify(userId));
  const r3 = await client.query("SELECT $1::uuid AS u", [userId]);
  console.log('cast:', r3.rows[0]);

  try {
    await client.query(
      "INSERT INTO tags (id, user_id, name, normalized_name) VALUES (gen_random_uuid(), $1::uuid, $2, $2) ON CONFLICT DO NOTHING",
      [userId, 'test-debug']
    );
    console.log('inserted OK');
  } catch (e) {
    console.log('insert failed:', e.message);
  }
  await client.query('ROLLBACK');
} finally {
  client.release();
  await pool.end();
}
