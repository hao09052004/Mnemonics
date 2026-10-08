# Supabase Credential Exposure — Remediation Guide

> **Severity:** P0 — Security
> **Status:** Repository remediation complete. Live credential rotation NOT YET confirmed by the operator.

## Incident summary

A prior security audit of `hao09052004/Mnemonics` found hardcoded
Supabase service-role and anon credentials committed to the public
GitHub repository, plus a hardcoded `postgres` admin password inside
a one-off schema-probe script. A Supabase service-role JWT bypasses
Row Level Security and can read or write every row in the project,
including the `auth.users` table; the `postgres` superuser is even
more privileged.

**The exposed service-role key and the leaked `postgres` password are
treated as compromised until the operator rotates them.** Removing
them from the latest commit is necessary but not sufficient.

## Affected file paths (current branch, post-cleanup)

The following files previously contained hardcoded credentials and
were modified in branch
`fix/security-supabase-credential-exposure`:

| File | Credential removed | Classification |
|------|--------------------|----------------|
| `scripts/seed-user.ps1` | Supabase service-role JWT | Privileged |
| `scripts/seed-qa-user.mjs` | Supabase service-role JWT | Privileged |
| `scripts/check-storage.mjs` | Supabase service-role JWT | Privileged |
| `scripts/check-items.mjs` | Supabase service-role JWT | Privileged |
| `scripts/check-buckets.mjs` | Supabase service-role JWT | Privileged |
| `scripts/repro-signup.mjs` | Supabase anon JWT | Public-client key |
| `apps/api/scripts/probe-items-schema.mts` | Postgres `postgres` admin password | Privileged |

The Supabase project ref (`jtmowwttmjtmceihzvreu`) and the
corresponding `aws-0-ap-northeast-1.pooler.supabase.com` connection
string are no longer present in any tracked file.

## Credential classifications

The remediation distinguishes three classes of Supabase key:

1. **Service-role JWT (`role: service_role`)** — privileged,
   server-only. Must never appear in source, browser bundles, or
   extension code. **The previously committed key is treated as
   compromised.**
2. **Anon / publishable key (`role: anon`)** — public-client key,
   safe to embed in browser code subject to working RLS, but still
   worth rotating if it has been published.
3. **Postgres admin password** — privileged, server-only. **The
   previously committed password is treated as compromised.**

## Safe local and production configuration

Every script now reads credentials from the environment and fails
fast with a sanitized message when they are missing. There is no
embedded fallback, no placeholder JWT, and no echo of the value
into logs.

### Required environment variables

| Variable | Where | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | Node scripts + PowerShell | e.g. `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only | Privileged; never expose to web/extension |
| `SUPABASE_ANON_KEY` | Web / extension (if needed) | Public-client key subject to RLS |
| `DATABASE_URL` | Schema probe, migrations | Postgres connection string |

`.env.example` is the source of truth for the full list. It now
contains only safe placeholders. Real values live in
`.env`, `.env.production`, deployment platform environment
variables, or secret managers — never in source.

### Loading conventions

* **Node.js scripts** use the existing `dotenv` convention to load
  the root `.env` file when present:
  ```js
  import { config } from 'dotenv';
  import { resolve } from 'node:path';
  config({ path: resolve(process.cwd(), '.env') });
  ```
  They then read `process.env.SUPABASE_URL` etc.
* **PowerShell** uses `$env:SUPABASE_URL` after the operator has
  set it in the current session or a parent environment.

Scripts fail fast with a message of the form:

```
SUPABASE_SERVICE_ROLE_KEY is not configured.
Set it before running, e.g.:
  SUPABASE_SERVICE_ROLE_KEY=<jwt> node scripts/seed-qa-user.mjs
```

The literal value is never printed.

## Required operator actions

These steps are **manual and operator-driven**. They are
prerequisites for marking the incident fully resolved.

1. **Identify the affected Supabase project.** Project ref:
   `jtmowwtmjtmceihzvreu`. Region: `ap-northeast-1`.
2. **Determine the credential format.** All previously committed
   Supabase credentials were **legacy JWT-based** keys (an
   `eyJ...` string with an `HS256` signature). Supabase is in the
   process of replacing these with the newer secret-API-key format;
   confirm which one is in use before rotating.
3. **Consult the current official Supabase rotation guide.** The
   rotation method differs for the two formats. The official
   documentation is the source of truth:
   * Legacy JWT service-role key: rotate via
     `Project Settings → API → Service Role Secret`. The dashboard
     re-issues a new JWT and the previous one stops working.
   * Newer secret API key: rotate via
     `Project Settings → API Keys → Generate new secret key`. The
     previous secret is invalidated immediately.
4. **Revoke the exposed credential.** The old JWT must be deleted
   from the dashboard, not just hidden.
5. **Assess whether to rotate the project's JWT signing secret.**
   Rotating the signing secret invalidates every existing user
   session and every integration. **Do not rotate casually.**
   Recommended only if there is evidence of token forgery beyond
   the leaked service-role key.
6. **Update server-side environment variables** in every
   deployment platform that consumes the credential (Render,
   Railway, GitHub Actions secrets, local dev `.env`, etc.).
7. **Restart / redeploy** the affected backend services so the
   new credential is loaded. The previous key is no longer
   trusted; in-flight requests may still succeed, but new ones
   must be authenticated with the rotated value.
8. **Confirm backend authentication and storage access** with the
   replacement credential (smoke `GET /api/v1/items`,
   `POST /api/v1/captures/document`, a single storage upload).
9. **Review available logs** in the Supabase dashboard
   (`Auth → Users`, `Database → Logs`, `Storage → Logs`,
   `Logs Explorer`) for any privileged activity originating from
   sources other than the Mnemonics backend. Pay particular
   attention to:
   * `auth.users` reads or admin writes outside known backend IPs.
   * `storage.objects` reads of `mnemonics-assets/*` outside the
     backend service.
   * Use of the service-role key from third-party networks.

10. **Mark the rotation CONFIRMED only after step 9 is clean.**

## Deployment update checklist

* [ ] Rotate the exposed service-role credential in the Supabase
      dashboard.
* [ ] Rotate the exposed Postgres admin password.
* [ ] (Optional, see step 5) Rotate the JWT signing secret.
* [ ] Update `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in:
      * local `.env` (developer machines)
      * Render / Railway / Vercel / etc. environment
      * GitHub Actions secrets used by the demo workflow
* [ ] Update `DATABASE_URL` with the new Postgres password.
* [ ] Redeploy the API service and confirm health checks pass.
* [ ] Run a single capture and a single document upload to confirm
      end-to-end functionality.

## Git history remediation options

Removing the credentials from the latest commit is **necessary but
insufficient** — they are still present in earlier commits and may
have been cloned, downloaded, or scanned by third parties.

The following options are available. None is automatic; each
carries risk and the operator must approve.

| Option | Effect | Risk |
|--------|--------|------|
| **Status quo** | Credentials remain in history | Visible to anyone with read access to past commits / clones |
| **`git filter-repo` / BFG** | Rewrites history to drop the offending commits | Breaks existing clones, PRs, and signed commits; force-push required |
| **Rotate only, do not rewrite** | Old credentials become invalid via Supabase rotation; history stays | Old tokens are still readable but no longer authenticate |

**Revocation (operator step 4) MUST happen regardless of which
option is chosen. Rewriting history cannot guarantee deletion from
third-party clones, archive mirrors, or already-downloaded
artifacts.**

If the operator chooses to rewrite history:

1. Take a full backup of the repository.
2. Coordinate with all collaborators (force-push will break their
   branches).
3. Run `git filter-repo --invert-paths --path scripts/seed-user.ps1
   --path scripts/seed-qa-user.mjs ...` (one `--path` per file).
4. Force-push every branch and every tag.
5. Notify GitHub to invalidate cached views and force-refresh any
   PR refs.
6. Rotate all credentials again (the previous keys were readable
   during the window between publish and rewrite).

The current cleanup branch does **not** rewrite history. That is a
deliberate, opt-in decision the operator must approve separately.

## RLS / security review summary

A focused review of the current Supabase / PostgreSQL trust
boundaries found no additional RLS or authorization vulnerabilities
introduced by this change. Specifically:

* The web dashboard (`apps/web/`) and the Chrome/Edge extension
  (`apps/extension/`) continue to use the API, never the Supabase
  service-role key. `apps/extension/api-client.js` and
  `apps/web/src/lib/api-client.ts` carry no service-role
  credentials and no VITE_-prefixed secrets.
* The API (`apps/api/src/server.ts`) only reads
  `SUPABASE_SERVICE_ROLE_KEY` from the environment. It is the
  only place a service-role credential is consumed.
* Storage bucket access uses authenticated, private buckets with
  server-side signed URLs. No client-side path can mint a signed
  URL.
* `apps/api/src/auth/__tests__/auth-client.contract.test.ts`
  asserts the extension's `auth-client.js` never references the
  service-role key or the `SUPABASE_SERVICE_ROLE_KEY` env name.
* RLS is enabled on every per-user table; the new cluster and
  document tests continue to honor user ownership and reject
  cross-user reads.

## Verification

The repository-side changes have been verified with:

* `pnpm typecheck` — all workspace packages green
* `pnpm test` (apps/api) — 200+ existing tests + the new
  secret-scan + scripts-config regression suites pass
* `pnpm --recursive build` — all 6 packages build
* `pnpm gates:all` — agent / skill / spec-sync / coverage gates
  pass
* A new GitHub Actions workflow
  (`.github/workflows/secret-scan.yml`) runs Gitleaks on every
  push to `main`, `develop`, `feat/**`, `fix/**` and on every
  pull request targeting `main` or `develop`. Gitleaks is pinned
  to a specific action SHA.
* `.gitleaks.toml` allowlists only safe placeholders
  (`.env.example`, docs that show truncated `eyJ...` strings, and
  the synthetic `TEST_SCAN_FINDING_*` token used by the
  regression test).

### Local developer workflow

Before pushing, a developer can run the same scan locally:

```bash
# Option A — install gitleaks (macOS / Linux):
brew install gitleaks
gitleaks detect --source . --config .gitleaks.toml --redact

# Option B — the in-tree regression test (no extra tooling):
pnpm --filter @mnemonics/api test -- src/__tests__/secret-scan.test.ts
pnpm --filter @mnemonics/api test -- src/__tests__/scripts-config.test.ts
```

The Vitest suites run as part of the regular test command and need
no additional installation.

## Remaining risks

* The exposed service-role JWT remains valid until the operator
  completes the rotation in the Supabase dashboard. **Repository
  cleanup does not invalidate the credential.**
* The exposed Postgres password remains valid until the operator
  rotates it. Same caveat.
* The credentials are still present in the git history of every
  branch and tag that pre-dates this cleanup. Cloning or
  downloading the repository prior to history rewriting exposes
  them. Mitigated only by rotation.
* If any third party scraped the public repository, downloaded
  artifacts, or captured CI logs before this commit, the
  credentials are outside our reach. Rotation is the only
  authoritative defense.

## Final status

| Item | Status |
|------|--------|
| **Repository remediation** | PASS (no tracked file contains a hardcoded privileged credential) |
| **Live credential rotation** | NOT CONFIRMED (operator action required) |
| **Historical exposure** | REQUIRES FOLLOW-UP (operator decision on `git filter-repo`) |
| **Production security verification** | PASS (RLS unchanged, no new authorization bugs found) |
