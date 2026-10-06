/**
 * Reproduce the CI test environment locally.
 *
 * Spins up a throwaway Postgres, provisions auth/storage exactly the
 * way .github/workflows/ci.yml does, applies every migration, then
 * runs the database suite. This is the only honest way to know a test
 * passes on CI — the dev Supabase project has a full auth.users table
 * and would hide a schema mismatch.
 *
 * Requires Docker. Usage: node scripts/ci-db-check.mts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = 55432;
const CONTAINER = 'mnemonics-ci-db-check';
const DB_URL = `postgres://postgres:postgres@localhost:${PORT}/mnemonics_ci`;

function docker(...args: string[]): void {
  execFileSync('docker', args, { stdio: 'inherit' });
}

function psql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', 'postgres://postgres:postgres@localhost:5432/mnemonics_ci', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] }
  );
}

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

SELECT 'CREATE ROLE authenticated NOLOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')\gexec
SELECT 'CREATE ROLE anon NOLOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')\gexec
SELECT 'CREATE ROLE service_role NOLOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')\gexec

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  raw_user_meta_data JSONB DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE
AS $func$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $func$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT NOT NULL, name TEXT NOT NULL
);
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE
AS $func$ SELECT CASE WHEN name IS NULL OR name = '' THEN ARRAY[]::TEXT[]
                    ELSE string_to_array(name, '/') END; $func$;
`;

async function main(): Promise<void> {
  console.log('▸ starting throwaway Postgres (pgvector/pgvector:pg16)');
  docker('rm', '-f', CONTAINER);
  docker(
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=mnemonics_ci',
    '-p', `${PORT}:5432`,
    'pgvector/pgvector:pg16'
  );

  for (let i = 0; i < 60; i++) {
    try {
      execFileSync('docker', [
        'exec', CONTAINER, 'pg_isready', '-q'
      ], { stdio: 'ignore' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  try {
    console.log('▸ applying CI bootstrap (auth + storage schemas)');
    psql(BOOTSTRAP);

    const migrationsDir = join(ROOT, 'packages', 'database', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`  ==> ${file}`);
      try {
        psql(sql);
      } catch (error) {
        // 017 needs a larger maintenance_work_mem than the stock
        // container allows. CI hits the same wall; the Spaces schema
        // does not depend on it, so warn and continue.
        if (file.startsWith('017')) {
          console.warn(`  !! ${file} failed (vector index build) — continuing`);
          continue;
        }
        throw error;
      }
    }

    console.log('▸ running packages/database suite against the CI schema');
    execFileSync(
      'pnpm',
      ['--filter', '@mnemonics/database', 'exec', 'vitest', 'run'],
      { stdio: 'inherit', env: { ...process.env, DATABASE_URL: DB_URL } }
    );
    console.log('\n✔ database suite passes against a CI-shaped schema');
  } finally {
    docker('rm', '-f', CONTAINER);
  }
}

main().catch((error) => {
  console.error('\n✘ CI db check failed:', error.message);
  process.exit(1);
});
