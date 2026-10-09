/**
 * Read-only: list every trigger on tables in the `public` schema.
 * Used to debug why the jobs table appears to gain new active
 * rows mid-transaction even after the API server is stopped.
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
    `SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement
       FROM information_schema.triggers
      WHERE event_object_schema='public'
      ORDER BY event_object_table, trigger_name`
  );
  console.log(`triggers: ${r.rowCount}`);
  for (const row of r.rows) {
    console.log(`  ${row.event_object_table}.${row.trigger_name} (${row.action_timing} ${row.event_manipulation})`);
  }
  const conns = await client.query(
    `SELECT pid, application_name, client_addr, state, query_start, LEFT(query, 200) AS query
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
      ORDER BY query_start DESC NULLS LAST`
  );
  console.log(`\nactive connections: ${conns.rowCount}`);
  for (const c of conns.rows) {
    console.log(`  pid=${c.pid} state=${c.state} app=${c.application_name} addr=${c.client_addr}`);
    console.log(`    query: ${c.query}`);
  }
  // Also list any background workers / cron / replication slots.
  const bg = await client.query(
    `SELECT pid, application_name, state FROM pg_stat_activity WHERE backend_type IS NOT NULL AND backend_type <> 'client backend'`
  );
  console.log(`\nbackground workers: ${bg.rowCount}`);
  for (const c of bg.rows) {
    console.log(`  pid=${c.pid} type=${c.application_name} state=${c.state}`);
  }
  // List cron jobs.
  try {
    const cron = await client.query(`SELECT jobname, schedule, command FROM cron.job ORDER BY jobname`);
    console.log(`\ncron jobs: ${cron.rowCount}`);
    for (const c of cron.rows) console.log(`  ${c.jobname}: ${c.schedule} -> ${c.command}`);
    const run = await client.query(`SELECT jobname, status, start_time, end_time, return_message
                                      FROM cron.job_run_details
                                     ORDER BY start_time DESC NULLS LAST LIMIT 5`);
    console.log(`recent cron runs: ${run.rowCount}`);
    for (const c of run.rows) console.log(`  ${c.jobname} ${c.status} at ${c.start_time}: ${c.return_message}`);
  } catch {
    console.log('no cron extension');
  }
} finally {
  await client.end();
}
