/**
 * Read-only: list every item_id that has BOTH a `failed` and a
 * `pending`/`processing` embed job. The recovery script will
 * delete the failed row for these items.
 */
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

function loadEnv(): void {
  const candidates = ["../../../.env", "../../.env", "../.env", ".env"];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const text = readFileSync(c, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return;
  }
}
loadEnv();

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const r = await client.query<{ item_id: string; failed_id: string; active_id: string; active_status: string }>(
    `SELECT DISTINCT ON (j.item_id) j.item_id, j.id AS failed_id, j2.id AS active_id, j2.status AS active_status
       FROM jobs j
       JOIN jobs j2
         ON j2.item_id = j.item_id
        AND j2.type = j.type
        AND j2.status IN ('pending','processing')
        AND j2.id <> j.id
      WHERE j.status = 'failed' AND j.type = 'embed'`
  );
  console.log(`Items with both failed and active embed jobs: ${r.rowCount}`);
  for (const row of r.rows) {
    console.log(`  item=${row.item_id} failed=${row.failed_id} active=${row.active_id} (${row.active_status})`);
  }
} finally {
  await client.end();
}
