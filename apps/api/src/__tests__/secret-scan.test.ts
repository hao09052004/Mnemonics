/**
 * Secret-scanning regression test.
 *
 * Goal: prove the repository cleanup succeeded and the same mistake
 * cannot recur silently. The test reads every file under `apps/`,
 * `packages/`, `scripts/`, and `deploy/`, and asserts that no
 * tracked source file contains a hardcoded Supabase service-role
 * JWT, anon JWT, or a Postgres admin password.
 *
 * Detection is intentionally narrow: it looks for the specific
 * patterns that leaked in the P0 incident (Supabase project refs,
 * JWT-style tokens with the "service_role" / "anon" claim, the
 * `postgresql://postgres.<project>:<password>@...` form). It is
 * not a replacement for Gitleaks; it is a fast, deterministic
 * second line of defense that runs in CI without external tooling.
 *
 * If you ever need to add a real credential to a tracked file
 * (you should not), this test is the reason CI will fail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// walk up to repo root: apps/api/src/<...>/__tests__ → repo root
const repoRoot = resolve(here, '..', '..', '..', '..');

const SCAN_DIRS = ['apps', 'packages', 'scripts', 'deploy'];
const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts',
  '.ps1', '.psm1', '.psd1',
  '.sh', '.bash',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.sql'
]);
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git',
  '.next', 'out', '.vite', '.turbo', '.figma', 'figma-ui-reference',
  'pnpm-lock.yaml', '.logs', '.knowledge-regression'
]);

// The placeholder JWTs the docs and the contract test use. They
// must NEVER be removed from this list — they are the only strings
// the scanner is allowed to ignore.
const ALLOWED_PLACEHOLDERS = new Set([
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IltZT1VSLVBST0pFQ1QtUkVGXSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3ODk2OTk1NTUsImV4cCI6MjEwNTI3NTU1NX0.placeholder',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IltZT1VSLVBST0pFQ1QtUkVGXSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg5Njk5NTU1LCJleHAiOjIxMDUyNzU1NTV9.placeholder',
  'eyJ...', // truncated placeholder in docs
  'TEST_SCAN_FINDING_synthetic_value_for_unit_test_only'
]);

// Synthetic token the regression test inserts to verify the scanner
// still works. This is NOT a real credential — the value is generated
// at runtime and lives only in memory while the test runs.
const SYNTHETIC_SERVICE_ROLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3Rwcm9qZWN0cmVmIi' +
  'wicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMDAwMDAwMCwi' +
  'ZXhwIjoyMTA1Mjc1NTU1fQ' +
  '.TEST_SCAN_FINDING_synthetic_value_for_unit_test_only';

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (SCAN_EXTENSIONS.has(ext)) {
        yield full;
      }
    }
  }
}

function isFixturePlaceholderPath(repoRel) {
  // Fixtures and docs are allowed to mention JWTs so long as the
  // value is a known placeholder. Real-looking tokens are never
  // allowed anywhere.
  return repoRel.includes(`${sep}__tests__${sep}`) ||
    repoRel.endsWith('.env.example') ||
    repoRel.endsWith('.env.demo') ||
    repoRel.endsWith('.env.e2e') ||
    repoRel.endsWith('README.md') ||
    repoRel.endsWith('docs/security/supabase-credential-remediation.md');
}

function findServiceRoleMatches(text) {
  // Match a JWT shape (`aaa.bbb.ccc`) where the payload decodes
  // to the Supabase service-role claim. We only inspect the
  // payload locally — never log the value.
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  const out = [];
  let m;
  while ((m = jwtRe.exec(text)) !== null) {
    const token = m[0];
    if (ALLOWED_PLACEHOLDERS.has(token)) continue;
    const [, payload] = token.split('.');
    try {
      const decoded = Buffer.from(payload, 'base64url').toString('utf8');
      if (/role["']?\s*:\s*["']?service_role/.test(decoded)) {
        out.push({ token, payload: decoded, offset: m.index });
      }
    } catch {
      // Not valid base64 — ignore; this test is not the JWT
      // parser. The presence of malformed tokens in source is
      // suspicious on its own and will trip the gitleaks job.
    }
  }
  return out;
}

function findAnonMatches(text) {
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  const out = [];
  let m;
  while ((m = jwtRe.exec(text)) !== null) {
    const token = m[0];
    if (ALLOWED_PLACEHOLDERS.has(token)) continue;
    const [, payload] = token.split('.');
    try {
      const decoded = Buffer.from(payload, 'base64url').toString('utf8');
      if (/role["']?\s*:\s*["']?anon/.test(decoded)) {
        out.push({ payload: decoded, offset: m.index });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function findHardcodedDbPasswords(text) {
  // postgresql://postgres.<project>:<password>@...
  // The previous incident leaked this exact form.
  const re = /postgresql:\/\/postgres\.[A-Za-z0-9_-]+:[A-Za-z0-9!@#$%^&*()_+\-={}\[\]:";'<>?,./`~]{8,}@[^\s'"]+/g;
  return text.match(re) ?? [];
}

function findHardcodedProjectRefs(text) {
  // The Supabase project ref is a 20-char identifier. Combined with
  // a `supabase.co` host it is a strong indicator of a leaked
  // value. We allow docs to mention `[YOUR-PROJECT-REF]` and
  // `.supabase.co` in plain text.
  const re = /[a-z]{20}\.supabase\.co/g;
  return text.match(re) ?? [];
}

describe('secret-scanning regression (P0 incident follow-up)', () => {
  const files = [];
  for (const dir of SCAN_DIRS) {
    for (const f of walk(resolve(repoRoot, dir))) {
      files.push(f);
    }
  }

  it('scans a non-trivial number of source files', () => {
    // Sanity check that the walker ran. If this fails, the
    // manifest of scanned directories drifted and the rest of
    // the file is meaningless.
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no hardcoded Supabase service-role JWT in any tracked file', () => {
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const hit of findServiceRoleMatches(text)) {
        offenders.push({ file: relative(repoRoot, f), offset: hit.offset });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no hardcoded Supabase anon JWT in any tracked file', () => {
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const hit of findAnonMatches(text)) {
        offenders.push({ file: relative(repoRoot, f), offset: hit.offset });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no hardcoded Postgres admin password (postgresql://postgres.<project>:<pw>@...)', () => {
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const match of findHardcodedDbPasswords(text)) {
        offenders.push({ file: relative(repoRoot, f), value: match });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no live Supabase project ref in scripts or app code', () => {
    // Docs and .env.example may mention `your-project` placeholders
    // and `.supabase.co` as a domain. This check is about the
    // hard-coded 20-character ref pattern.
    const offenders = [];
    for (const f of files) {
      const rel = relative(repoRoot, f);
      if (isFixturePlaceholderPath(rel)) continue;
      const text = readFileSync(f, 'utf8');
      for (const match of findHardcodedProjectRefs(text)) {
        offenders.push({ file: rel, value: match });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scanner detects a synthetic service-role JWT inserted at runtime', () => {
    // Insert the synthetic token into a buffer (NOT a tracked
    // file) and verify the scanner would have caught it. This
    // proves the detection logic works without ever putting a
    // real credential on disk.
    const buffer = `${SYNTHETIC_SERVICE_ROLE_JWT}\n`;
    const hits = findServiceRoleMatches(buffer);
    expect(hits.length).toBe(1);
    expect(hits[0].token).toBe(SYNTHETIC_SERVICE_ROLE_JWT);
  });
});
