import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: resolve(process.cwd(), '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';
const DEMO_USER_ID = process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001';

const pool = createPool(DATABASE_URL);

async function exec(sql: string, params: unknown[] = []) {
  return pool.query(sql, params);
}

function vector(axis: number) {
  const values = new Array(1536).fill(0);
  values[axis] = 1;
  return '[' + values.join(',') + ']';
}

async function bootstrapSupabaseCompatibility() {
  await exec('CREATE SCHEMA IF NOT EXISTS auth');
  await exec('CREATE SCHEMA IF NOT EXISTS storage');

  for (const role of ['authenticated', 'anon', 'service_role']) {
    const result = await exec('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (result.rowCount === 0) {
      await exec('CREATE ROLE ' + role + ' NOLOGIN');
    }
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      raw_user_meta_data JSONB DEFAULT '{}'
    )
  `);

  await exec(`
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS $func$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $func$
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public BOOLEAN NOT NULL DEFAULT false
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT NOT NULL,
      name TEXT NOT NULL
    )
  `);

  await exec(`
    CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
    RETURNS TEXT[]
    LANGUAGE sql
    IMMUTABLE
    AS $func$
      SELECT CASE
        WHEN name IS NULL OR name = '' THEN ARRAY[]::TEXT[]
        ELSE string_to_array(name, '/')
      END;
    $func$
  `);

  await exec(`
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('mnemonics-assets', 'mnemonics-assets', false)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function runMigrations() {
  const migrationsDir = resolve(process.cwd(), '../../packages/database/migrations');
  const files = (await readdir(migrationsDir))
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const file of files) {
    console.log('==> applying ' + file);
    const sql = await readFile(resolve(migrationsDir, file), 'utf8');
    await exec(sql);
  }
}

async function seedDemo() {
  await exec('DELETE FROM auth.users WHERE id = $1', [DEMO_USER_ID]);

  await exec(
    'INSERT INTO auth.users (id, raw_user_meta_data) VALUES ($1, $2::jsonb)',
    [DEMO_USER_ID, JSON.stringify({ name: 'Mnemonics Demo' })]
  );

  const items = [
    { id: '00000000-0000-4000-8000-000000000101', type: 'text', title: 'Spaced repetition for long-term memory', rawText: 'Learning works better when review sessions are distributed over time. Spaced repetition strengthens retrieval and makes memories easier to find later.', tags: ['learning', 'memory', 'study'], axis: 0 },
    { id: '00000000-0000-4000-8000-000000000102', type: 'text', title: 'Designing a fast capture workflow', rawText: 'Capture should take seconds: keep the title, selected text, source URL and timestamp together, then process tags and embeddings asynchronously.', tags: ['productivity', 'design', 'workflow'], axis: 1 },
    { id: '00000000-0000-4000-8000-000000000103', type: 'link', title: 'Knowledge graphs connect related ideas', rawText: 'A knowledge graph can connect similar memories so that one saved idea becomes a path to the next relevant idea.', sourceUrl: 'https://example.com/knowledge-graphs', tags: ['knowledge-graph', 'search', 'memory'], axis: 0 },
    { id: '00000000-0000-4000-8000-000000000104', type: 'text', title: 'Hybrid search combines keywords and meaning', rawText: 'Lexical search is precise for exact terms. Semantic search is useful when the query describes an idea without repeating the original wording.', tags: ['search', 'semantic', 'product'], axis: 0 },
    { id: '00000000-0000-4000-8000-000000000105', type: 'text', title: 'Reliable offline-first capture', rawText: 'A browser extension should keep a pending capture locally when the network is unavailable, then retry with the same idempotency key after connectivity returns.', tags: ['offline', 'sync', 'reliability'], axis: 1 },
    { id: '00000000-0000-4000-8000-000000000106', type: 'link', title: 'Building a second brain', rawText: 'The goal is simple: save once and find anytime. Good metadata, tags and related memories reduce the cost of retrieval.', sourceUrl: 'https://example.com/second-brain', tags: ['second-brain', 'productivity', 'memory'], axis: 1 }
  ];

  for (const [index, item] of items.entries()) {
    await exec(
      `
        INSERT INTO items
          (id, user_id, type, title, source_url, raw_text, captured_at, status, client_request_id)
        VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' days')::interval, 'ready', $8)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          source_url = EXCLUDED.source_url,
          raw_text = EXCLUDED.raw_text,
          status = EXCLUDED.status,
          updated_at = NOW()
      `,
      [item.id, DEMO_USER_ID, item.type, item.title, item.sourceUrl ?? null, item.rawText, String(index), item.id]
    );

    for (const tag of item.tags) {
      await exec(
        'INSERT INTO tags (id, user_id, name, normalized_name) VALUES (gen_random_uuid(), $1, $2, $2) ON CONFLICT (user_id, normalized_name) DO NOTHING',
        [DEMO_USER_ID, tag]
      );

      await exec(
        'INSERT INTO item_tags (item_id, tag_id) SELECT $1, id FROM tags WHERE user_id = $2 AND normalized_name = $3 ON CONFLICT DO NOTHING',
        [item.id, DEMO_USER_ID, tag]
      );
    }

    await exec(
      `
        INSERT INTO item_embeddings (item_id, model, dimensions, embedding)
        VALUES ($1, 'demo-embedding', 1536, $2::vector)
        ON CONFLICT (item_id) DO UPDATE SET
          model = EXCLUDED.model,
          dimensions = EXCLUDED.dimensions,
          embedding = EXCLUDED.embedding,
          updated_at = NOW()
      `,
      [item.id, vector(item.axis)]
    );
  }

  const edges = [
    ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000103', 0.94],
    ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104', 0.88],
    ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000105', 0.86],
    ['00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000106', 0.84]
  ];

  for (const [from, to, weight] of edges) {
    await exec(
      "INSERT INTO item_edges (user_id, from_item_id, to_item_id, edge_type, weight, attributes) VALUES ($1, $2, $3, 'similar', $4, $5::jsonb) ON CONFLICT (user_id, from_item_id, to_item_id, edge_type) DO UPDATE SET weight = EXCLUDED.weight",
      [DEMO_USER_ID, from, to, weight, JSON.stringify({ source: 'demo-seed' })]
    );
  }

  console.log('Demo account: demo@mnemonics.local / DemoPass123!');
  console.log('Seeded memories: ' + items.length);
}

async function main() {
  await bootstrapSupabaseCompatibility();
  await runMigrations();
  await seedDemo();
  await pool.end();
  console.log('Demo database ready.');
}

main().catch(async error => {
  console.error('Demo setup failed:', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
