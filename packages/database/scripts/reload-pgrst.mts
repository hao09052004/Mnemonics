/**
 * PostgREST schema-cache reload.
 *
 * After DDL changes Supabase's PostgREST keeps the old schema in
 * memory until either it receives a NOTIFY or it is restarted.
 * NOTIFY is faster and avoids downtime. The script sends
 * `NOTIFY pgrst, 'reload schema'` via a fresh connection.
 */
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

function loadEnv(): void {
  const candidates = [
    "../../../.env",
    "../../.env",
    "../.env",
    ".env"
  ];
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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("NOTIFY pgrst, 'reload schema'");
  console.log("Sent NOTIFY pgrst, 'reload schema' on the live connection.");
} finally {
  await client.end();
}
