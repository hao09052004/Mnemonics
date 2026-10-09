/**
 * Read-only: list every item_id that has more than one job of
 * type='embed', regardless of status. Used to find duplicate
 * failed jobs that the recovery script cannot promote
 * simultaneously.
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
  const r = await client.query<{ item_id: string; n: string }>(
    `SELECT item_id, COUNT(*)::text AS n
       FROM jobs
      WHERE type = 'embed'
        AND status = 'failed'
      GROUP BY item_id
     HAVING COUNT(*) > 1`
  );
  console.log(`items with multiple failed embed jobs: ${r.rowCount}`);
  for (const row of r.rows) console.log(`  item=${row.item_id} count=${row.n}`);
} finally {
  await client.end();
}
