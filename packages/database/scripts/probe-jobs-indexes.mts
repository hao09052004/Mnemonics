/**
 * Read-only: dump every index on the `jobs` table. Used to debug
 * unique-constraint violations when a recovery script tries to
 * reset a failed job to pending while another active job for the
 * same (item, type) already exists.
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
  const r = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='jobs'`
  );
  for (const row of r.rows) {
    console.log(`${row.indexname}\n  ${row.indexdef}`);
  }
} finally {
  await client.end();
}
