import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemId = '0a64b13d-2fdc-4e33-b4ab-7bd2c8e78674';
    const item = await client.query<{ userId: string }>('SELECT user_id FROM items WHERE id = $1', [itemId]);
    console.log('userId from items:', item.rows[0]);

    // Hard-code a different user_id (not from SELECT) to test if it's the SELECT that's the issue
    const hardUserId = 'b78f5f3a-f94c-44bc-92e3-b71ef91adddd';
    console.log('Trying hard-coded userId:', hardUserId);
    try {
      await client.query(
        `INSERT INTO tags (id, user_id, name, normalized_name)
         VALUES (gen_random_uuid(), $1::uuid, $2, $2)
         ON CONFLICT (user_id, normalized_name) DO NOTHING`,
        [hardUserId, 'test-hardcoded']
      );
      console.log('hardcoded insert: OK');
    } catch (e) {
      console.log('hardcoded insert failed:', e.message);
    }

    // Now try with userId from SELECT (might be different type due to pg driver inference)
    const userId = item.rows[0].userId;
    console.log('userId type:', typeof userId, 'isArray:', Array.isArray(userId), 'value:', JSON.stringify(userId));
    try {
      await client.query(
        `INSERT INTO tags (id, user_id, name, normalized_name)
         VALUES (gen_random_uuid(), $1::uuid, $2, $2)
         ON CONFLICT (user_id, normalized_name) DO NOTHING`,
        [userId, 'test-fromselect']
      );
      console.log('from-select insert: OK');
    } catch (e) {
      console.log('from-select insert failed:', e.message);
    }

    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  await pool.end();
})();
