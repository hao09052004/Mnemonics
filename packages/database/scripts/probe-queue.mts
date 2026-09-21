import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    // Find a real item and user_id from items table
    const item = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM items ORDER BY captured_at DESC LIMIT 1'
    );
    if (item.rows.length === 0) {
      console.log('No items in DB yet — cannot enqueue test job.');
    } else {
      const { id: itemId, user_id: userId } = item.rows[0];
      const job = await pool.query(
        `INSERT INTO jobs (type, item_id, user_id, payload) VALUES ('tag', $1, $2, '{}'::jsonb) RETURNING id`,
        [itemId, userId]
      );
      console.log('Inserted job id=' + job.rows[0].id + ' for item=' + itemId);

      // Wait a couple seconds for queue to pick up
      await new Promise((r) => setTimeout(r, 3000));

      const after = await pool.query(
        'SELECT id, type, status, attempts, error FROM jobs WHERE id = $1',
        [job.rows[0].id]
      );
      console.log('Job status after 3s:', after.rows[0]);
    }
    await pool.end();
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  }
})();
