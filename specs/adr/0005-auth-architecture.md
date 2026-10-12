# ADR 0005 — Auth facade architecture

> Status: Accepted (2026-09-19).
> Deciders: orchestrator, security-reviewer, planner.

## Context

The project ships web, extension, and API surfaces. All three must share one login +
registration experience so a user signing in on the web is recognised by the extension.
We use Supabase Auth. The naive approach (call Supabase directly from each client) leaks
the service-role key and bypasses our RLS policies.

## Decision

We adopt a **backend auth facade** shape:

1. `apps/api` exposes `/api/v1/auth/*` (8 endpoints). The facade wraps the
   `supabase.auth.*` client and:

   * Calls `signUp`, `signInWithPassword`, `refreshSession`, `signOut`, `getUser` via the
     **anon** client (anon key is acceptable to share with the front-end).
   * Calls `generateLink` and `setSession` via a **service-role** client **only** on the
     server. The service-role key never crosses the network boundary other than from
     `.env` to the API server.
2. `apps/web` and `apps/extension` consume the facade through an ESM `auth-client.js` and
   store the issued session in `chrome.storage.local` or `localStorage` (storage-agnostic
   adapter).
3. The facade also writes an `auth_events` row for every call and uses `auth_throttle` to
   lock out a single email after 5 failed login attempts within 15 min.

## Alternatives considered

* **Direct Supabase from each client.** Risk: front-end impersonates any user; loss of
  audit log; loss of per-email throttling.
* **Custom JWT issuer.** Cost: we become our own auth provider — re-implementing password
  hashing, rotation, refresh revocation. Rejected as YAGNI for the MVP.
* **Magic-link only, no password.** Easier but loses users with poor email reliability.
  We offer it as the *recovery* path but keep email + password as the primary.

## Consequences

* **Token hygiene is enforceable centrally** (one audit table, one throttler).
* **Schema drift is contained**: the only Supabase contract is documented at
  `specs/api/auth.md`.
* **Migration 003 is a hard prerequisite** for the throttle + audit functionality to
  operate. Without it, audit calls fail silently (logged but not promoted to error).
* **Email verification** is currently Supabase's default; we should keep an eye on the
  *unverified → first capture* flow. Today it returns `403 EMAIL_NOT_VERIFIED`.

## See also

* `specs/api/auth.md`
* `specs/plans/2026-09-19-auth-brainstorm.md`
* `specs/plans/2026-09-19-auth-login-register.md`
* `workflows/runs/2026-09-19-auth-login-register.md`
* `packages/database/migrations/003_auth_hardening.sql`
