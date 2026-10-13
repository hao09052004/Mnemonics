/**
 * Pre-deploy prerequisite check.
 *
 * Run this BEFORE pushing to Render / Vercel. It catches every
 * blocking issue that would otherwise surface as a 500 on the
 * first request:
 *
 *   1. DATABASE_URL reachable, pool-able
 *   2. schema_migrations table exists and has every expected file
 *   3. pgvector extension is enabled (REQUIRED for semantic search)
 *   4. Gemini API key is a valid auth key (live call returns 200)
 *   5. Supabase anon + service role keys decode as valid JWTs
 *      and their `iss` claim matches the SUPABASE_URL
 *   6. VITE_API_URL (if set) is an https URL pointing at a
 *      resolvable host
 *
 * Usage:
 *   pnpm --filter @mnemonics/api exec tsx scripts/check-deploy-prereqs.mts
 *
 * Exit code:
 *   0 = all required checks pass
 *   1 = at least one REQUIRED check failed
 *
 * The script never throws; every check has its own try/catch and
 * prints a colour-coded line. CI can `tee` the output to a log.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createPool } from '@mnemonics/database';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Read .env from the repo root, like the API does.
config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';

let failed = 0;
let warned = 0;

function pass(label: string, detail = ''): void {
  console.log(`${GREEN}✓${RESET} ${label}${detail ? `  ${BLUE}${detail}${RESET}` : ''}`);
}
function fail(label: string, detail = ''): void {
  failed += 1;
  console.log(`${RED}✗ ${label}${RESET}${detail ? `\n    ${detail}` : ''}`);
}
function warn(label: string, detail = ''): void {
  warned += 1;
  console.log(`${YELLOW}! ${label}${RESET}${detail ? `\n    ${detail}` : ''}`);
}
function heading(title: string): void {
  console.log(`\n${BLUE}── ${title} ──${RESET}`);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  // JWTs are header.payload.signature. Payload is base64url-encoded JSON.
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// 1. Database connection
// ─────────────────────────────────────────────────────────────────
heading('1. Database');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  fail('DATABASE_URL is not set', 'Set it in .env or pass it in the shell.');
} else {
  const pool = createPool(dbUrl, { connectionTimeoutMillis: 5000 });
  try {
    const v = await pool.query<{ v: string }>('SELECT version() AS v');
    pass('DATABASE_URL connects', v.rows[0]?.v?.split(' ').slice(0, 2).join(' '));
  } catch (e) {
    fail('DATABASE_URL cannot be reached', String((e as Error).message).slice(0, 200));
  }

  // pgvector extension
  try {
    const ext = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto') ORDER BY extname"
    );
    const names = ext.rows.map((r) => r.extname);
    if (names.includes('vector')) {
      pass('pgvector extension is enabled', names.join(', '));
    } else {
      fail('pgvector extension is missing',
        'Run: CREATE EXTENSION IF NOT EXISTS vector;  (Supabase: Database → Extensions → vector)');
    }
  } catch (e) {
    fail('pg_extension query failed', String((e as Error).message).slice(0, 200));
  }

  // Migrations applied
  try {
    const appliedRows = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    const applied = new Set(appliedRows.rows.map((r) => r.filename));
    const dir = resolve(process.cwd(), '../../packages/database/migrations');
    const expected = readdirSync(dir)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();
    const missing = expected.filter((f) => !applied.has(f));
    if (missing.length === 0) {
      pass(`All ${expected.length} migrations applied`, `${applied.size} entries in schema_migrations`);
    } else {
      fail(`${missing.length} migration(s) missing`, `Run: pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts\n    Missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
    }
  } catch (e) {
    fail('schema_migrations check failed', String((e as Error).message).slice(0, 200));
  }

  await pool.end();
}

// ─────────────────────────────────────────────────────────────────
// 2. Gemini API key
// ─────────────────────────────────────────────────────────────────
heading('2. Gemini API key');
const gemKey = process.env.GEMINI_API_KEY;
if (!gemKey) {
  fail('GEMINI_API_KEY is not set', 'Get a key at https://aistudio.google.com/apikey');
} else {
  // Format classification
  if (gemKey.startsWith('AIza')) {
    pass('GEMINI_API_KEY format: standard (AIza…)', 'OK for Free Tier; rotate to AQ.* after May 2026 for leaked-key enforcement');
  } else if (gemKey.startsWith('AQ.')) {
    pass('GEMINI_API_KEY format: authorization (AQ.*)', 'Bound to a service account; has leaked-key enforcement. Current best practice.');
  } else {
    warn('GEMINI_API_KEY format unknown', `Key starts with: ${gemKey.slice(0, 6)}… — may still work but cannot classify`);
  }

  // Live call: list models
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gemKey)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (r.ok) {
      const j = (await r.json()) as { models?: Array<{ name: string }> };
      const names = (j.models ?? []).map((m) => m.name);
      pass('Gemini API call returns 200', `${names.length} models visible`);
      if (names.includes('models/gemini-embedding-001')) {
        pass('gemini-embedding-001 is available');
      } else {
        warn('gemini-embedding-001 NOT in the model list', 'Update GEMINI_EMBEDDING_MODEL or pick a visible one');
      }
    } else {
      const body = (await r.text()).slice(0, 200);
      fail(`Gemini API returns ${r.status}`, body);
    }
  } catch (e) {
    fail('Gemini API call failed', String((e as Error).message).slice(0, 200));
  }
}

// ─────────────────────────────────────────────────────────────────
// 3. Supabase keys
// ─────────────────────────────────────────────────────────────────
heading('3. Supabase');
const sbUrl = process.env.SUPABASE_URL;
const sbAnon = process.env.SUPABASE_ANON_KEY;
const sbService = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!sbUrl) {
  fail('SUPABASE_URL is not set');
} else {
  if (!sbUrl.startsWith('https://') || !sbUrl.includes('.supabase.co')) {
    warn('SUPABASE_URL is not a standard *.supabase.co URL', sbUrl);
  } else {
    pass('SUPABASE_URL format OK', sbUrl);
  }
}

for (const [name, token] of [
  ['SUPABASE_ANON_KEY', sbAnon],
  ['SUPABASE_SERVICE_ROLE_KEY', sbService]
] as const) {
  if (!token) {
    fail(`${name} is not set`);
    continue;
  }
  const payload = decodeJwtPayload(token);
  if (!payload) {
    fail(`${name} is not a valid JWT (3 dot-separated parts, base64 payload)`);
    continue;
  }
  const iss = String(payload.iss ?? '');
  if (sbUrl && iss && !sbUrl.includes(iss.replace(/^https?:\/\//, '').replace(/\/$/, ''))) {
    warn(`${name} 'iss' claim does not match SUPABASE_URL`,
      `iss=${iss} but SUPABASE_URL=${sbUrl}`);
  } else {
    const role = String(payload.role ?? '');
    const exp = Number(payload.exp ?? 0);
    const expiresAt = exp ? new Date(exp * 1000).toISOString().slice(0, 10) : 'unknown';
    pass(`${name} decodes`, `role=${role || '?'}, exp=${expiresAt}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 4. Frontend env (Vercel)
// ─────────────────────────────────────────────────────────────────
heading('4. Frontend (Vercel)');
const viteApi = process.env.VITE_API_URL;
if (viteApi) {
  if (!viteApi.startsWith('https://')) {
    warn('VITE_API_URL is not https', viteApi);
  } else {
    try {
      const u = new URL(viteApi);
      pass('VITE_API_URL is a valid https URL', u.host);
    } catch (e) {
      fail('VITE_API_URL is not a valid URL', String((e as Error).message).slice(0, 200));
    }
  }
} else {
  warn('VITE_API_URL is not set (build will use default)', 'Set it before `pnpm --filter @mnemonics/web build`');
}

const viteWeb = process.env.VITE_WEB_URL;
if (viteWeb) {
  pass('VITE_WEB_URL is set', viteWeb);
} else {
  warn('VITE_WEB_URL is not set', 'Set it so the dashboard can build self-referential links');
}

// ─────────────────────────────────────────────────────────────────
// 5. Build artifacts
// ─────────────────────────────────────────────────────────────────
heading('5. Build artifacts');
const apiDist = resolve(process.cwd(), 'dist/server.js');
try {
  const { statSync } = await import('fs');
  const s = statSync(apiDist);
  pass('apps/api dist exists', `${(s.size / 1024).toFixed(0)} KB, mtime=${s.mtime.toISOString().slice(0, 19)}`);
} catch {
  fail('apps/api dist/server.js missing', 'Run: pnpm --filter @mnemonics/api build');
}

const webDist = resolve(process.cwd(), '../web/dist/index.html');
try {
  const { statSync } = await import('fs');
  const s = statSync(webDist);
  pass('apps/web dist/index.html exists', `${(s.size / 1024).toFixed(1)} KB, mtime=${s.mtime.toISOString().slice(0, 19)}`);
} catch {
  fail('apps/web dist/index.html missing', 'Run: pnpm --filter @mnemonics/web build');
}

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────
console.log('');
if (failed === 0 && warned === 0) {
  console.log(`${GREEN}All checks passed. Safe to deploy.${RESET}`);
} else if (failed === 0) {
  console.log(`${YELLOW}${warned} warning(s), 0 failures. Safe to deploy but review the warnings.${RESET}`);
} else {
  console.log(`${RED}${failed} failure(s)${warned ? `, ${warned} warning(s)` : ''}. Fix the failures before deploying.${RESET}`);
}

// Defer exit so libuv has time to flush outstanding handles on
// Windows (the PG pool keep-alive socket otherwise trips an
// assertion in src\win\async.c during process teardown). 500 ms
// is enough to drain dotenv's read stream and the fetch keep-alive
// socket for the Gemini list-models call.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 500);
