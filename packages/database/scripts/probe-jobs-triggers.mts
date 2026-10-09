/**
 * Read-only: list every trigger that can fire on INSERT/UPDATE of
 * the `jobs` table. Used to find code paths that may be inserting
 * or auto-promoting jobs without our knowledge.
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
      WHERE event_object_schema='public' AND event_object_table='jobs'`
  );
  console.log(`jobs triggers: ${r.rowCount}`);
  for (const row of r.rows) {
    console.log(`  ${row.trigger_name} (${row.action_timing} ${row.event_manipulation})`);
    console.log(`    ${row.action_statement}`);
  }
  // List RLS policies on jobs.
  const rls = await client.query(
    `SELECT polname, polcmd, polqual::text, polwithcheck::text
       FROM pg_policy
      WHERE polrelid = 'public.jobs'::regclass`
  );
  console.log(`\njobs policies: ${rls.rowCount}`);
  for (const p of rls.rows) {
    console.log(`  ${p.polname} (${p.polcmd})`);
  }
  // List functions defined on public schema that might enqueue jobs.
  const fns = await client.query(
    `SELECT n.nspname, p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (pg_get_functiondef(p.oid) ILIKE '%insert%jobs%' OR pg_get_functiondef(p.oid) ILIKE '%enqueue%')
      ORDER BY p.proname`
  );
  console.log(`\njob-enqueueing functions: ${fns.rowCount}`);
  for (const f of fns.rows) {
    console.log(`  ${f.nspname}.${f.proname}`);
    console.log(`    ${f.def.substring(0, 300)}`);
  }
} finally {
  await client.end();
}
