/**
 * Configuration regression test for the operator scripts.
 *
 * Goal: prove the scripts that used to carry hardcoded Supabase
 * credentials now:
 *   1. accept credentials via the environment,
 *   2. fail safely (no fallback, no echo) when the env is missing,
 *   3. never embed a real credential in source.
 *
 * The scripts are loaded as text and statically analyzed. We do
 * NOT execute them — running them would either fail (env missing)
 * or hit the live Supabase project, both of which are undesirable
 * in CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');

const SCRIPTS = [
  'scripts/seed-user.ps1',
  'scripts/seed-qa-user.mjs',
  'scripts/check-storage.mjs',
  'scripts/check-items.mjs',
  'scripts/check-buckets.mjs',
  'scripts/repro-signup.mjs',
  'apps/api/scripts/probe-items-schema.mts'
];

function read(rel) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

describe('operator scripts (P0 credential-exposure follow-up)', () => {
  for (const rel of SCRIPTS) {
    describe(`${rel}`, () => {
      const source = read(rel);

      it('does not embed a Supabase service-role JWT in source', () => {
        // A service-role JWT has the "service_role" claim. We
        // accept the literal string "service_role" in SQL role
        // names or comments, but not inside a JWT.
        const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
        const matches = source.match(jwtRe) ?? [];
        for (const m of matches) {
          const [, payload] = m.split('.');
          let decoded = '';
          try {
            decoded = Buffer.from(payload, 'base64url').toString('utf8');
          } catch {
            continue;
          }
          expect(
            /role["']?\s*:\s*["']?service_role/.test(decoded),
            `service-role JWT found in ${rel}: ${m.slice(0, 12)}…`
          ).toBe(false);
        }
      });

      it('does not embed a Supabase anon JWT in source', () => {
        const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
        const matches = source.match(jwtRe) ?? [];
        for (const m of matches) {
          const [, payload] = m.split('.');
          let decoded = '';
          try {
            decoded = Buffer.from(payload, 'base64url').toString('utf8');
          } catch {
            continue;
          }
          expect(
            /role["']?\s*:\s*["']?anon/.test(decoded),
            `anon JWT found in ${rel}: ${m.slice(0, 12)}…`
          ).toBe(false);
        }
      });

      it('reads SUPABASE_URL and the appropriate key from the environment', () => {
        // Each script must consult process.env (Node) or $env:
        // (PowerShell). It must NOT carry a hardcoded fallback
        // that would re-introduce a credential.
        if (rel.endsWith('.ps1')) {
          expect(source).toMatch(/\$env:SUPABASE_URL/);
          expect(source).toMatch(/\$env:SUPABASE_SERVICE_ROLE_KEY/);
        } else if (rel === 'apps/api/scripts/probe-items-schema.mts') {
          // The schema probe needs the Postgres URL, not a
          // Supabase JWT. It still must come from the env.
          expect(source).toMatch(/process\.env\.DATABASE_URL/);
          expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
        } else if (rel === 'scripts/repro-signup.mjs') {
          expect(source).toMatch(/process\.env\.SUPABASE_URL/);
          expect(source).toMatch(/process\.env\.SUPABASE_ANON_KEY/);
        } else {
          expect(source).toMatch(/process\.env\.SUPABASE_URL/);
          expect(source).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
        }
      });

      it('fails fast with a sanitized message when credentials are missing', () => {
        // We do not run the script — we assert the early-exit
        // guard exists. The message must NOT include the literal
        // env value, only the variable name.
        if (rel.endsWith('.ps1')) {
          expect(source).toMatch(/is not configured/i);
          expect(source).toMatch(/exit\s+1/);
        } else {
          expect(source).toMatch(/is not configured/);
          expect(source).toMatch(/process\.exit\(1\)/);
        }
        // The error message must never include the literal
        // value of the env var.
        expect(source).not.toMatch(/console\.(log|error)\([^)]*process\.env\./);
        expect(source).not.toMatch(/Write-Host\s+\$env:/);
      });

      it('does not embed a Postgres admin password', () => {
        expect(source).not.toMatch(/postgresql:\/\/postgres\.[A-Za-z0-9_-]+:[A-Za-z0-9!@#$%^&*()_+\-={}\[\]:";'<>?,./`~]{8,}@/);
      });
    });
  }
});
