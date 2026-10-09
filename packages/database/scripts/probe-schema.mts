/**
 * Schema probe: dump the actual columns of item_embeddings, the
 * existence of item_document_chunks and item_edges, and the rows
 * in the migrations ledger. Used to decide whether migration 022
 * is missing on the live database.
 *
 * Read-only. Never mutates state.
 */
import { Client } from "pg";

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
    const m = await client.query<{
      version: string;
      applied_at: string;
      checksum: string | null;
    }>(
      `select version, applied_at, checksum
         from schema_migrations
        order by version`
    );
    console.log("schema_migrations rows:");
    for (const r of m.rows) {
      console.log(`  ${r.version} @ ${r.applied_at} sha=${r.checksum ?? "-"}`);
    }
  } catch (e) {
    console.log("schema_migrations table not queryable:", (e as Error).message);
  }
} finally {
  await client.end();
}
