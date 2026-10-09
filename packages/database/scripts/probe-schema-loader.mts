/**
 * Schema probe (load-dotenv): dump item_embeddings columns, the
 * existence of related tables, and the migrations ledger. Used to
 * decide whether migration 022 is missing on the live database.
 *
 * Read-only. Never mutates state.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const envPath = process.argv[2] ?? "../../.env";
const text = readFileSync(envPath, "utf8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const key = m[1];
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
  if (process.env[key] === undefined) process.env[key] = val;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

try {
  const cols = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position`,
    ["item_embeddings"]
  );
  console.log("item_embeddings columns:");
  for (const r of cols.rows) {
    console.log(`  ${r.column_name}: ${r.data_type} (${r.is_nullable})`);
  }

  for (const t of ["item_document_chunks", "item_edges", "jobs", "schema_migrations"]) {
    const r = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.tables
         where table_schema='public' and table_name=$1
       ) as exists`,
      [t]
    );
    console.log(`table ${t}: ${r.rows[0].exists ? "present" : "MISSING"}`);
  }

  try {
    const m = await client.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='schema_migrations'
        order by ordinal_position`
    );
    console.log("schema_migrations columns:", m.rows.map((r: { column_name: string }) => r.column_name).join(", "));
    const all = await client.query("select * from schema_migrations order by 1 limit 50");
    console.log(`schema_migrations rows (${all.rowCount ?? 0}):`);
    for (const r of all.rows) {
      const entries = Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`  ${entries}`);
    }
  } catch (e) {
    console.log("schema_migrations table not queryable:", (e as Error).message);
  }
} finally {
  await client.end();
}
