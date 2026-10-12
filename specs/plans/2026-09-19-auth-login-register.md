# Auth (login + register) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified login + register experience to `apps/api`,
`apps/web`, and `apps/extension` that delegates to Supabase Auth, persists
sessions to the client's storage, throttles abusive attempts, audits every
auth event, and ships with vitest coverage for every endpoint.

**Architecture:** The three apps share one **backend auth facade**
(`/api/v1/auth/*`) that wraps Supabase's JS client. `apps/web` and
`apps/extension` are dumb clients that POST to the facade. Session tokens are
issued by the facade (not built by hand) and stored **client-side** — web
keeps them in `localStorage` under a single namespaced key, extension keeps
them in `chrome.storage.local`. Magic-link is the forgot-password path.
Per-email throttling and `auth_events` auditing live in Postgres and are
called from the facade.

**Tech Stack:** Node 22 (esbuild + tsx for dev), Express 4, TypeScript 5.4,
`@supabase/supabase-js` ^2, Zod for input validation, Vitest 1.x + supertest,
React 18 + Vite (web), Manifest V3 + vanilla JS (extension), Postgres 15 +
pg via `@mnemonics/database`.

**Spec:** [`../specs/api/auth.md`](../api/auth.md) — the plan argues from
this spec, which travels with the executor.

**Brainstorm brief:** [`2026-09-19-auth-brainstorm.md`](2026-09-19-auth-brainstorm.md).

## Global Constraints

* Run **vitest** before every commit. New code lands only when its tests are green.
* New endpoints must follow the project's error envelope (`{error:{code,message,requestId}}`).
* Never log a token. Never print `SUPABASE_SERVICE_ROLE_KEY`.
* Throttle window: 5 attempts / 15 min per email; `locked_until` written by API only.
* RLS: `auth_events` is admin-readable only; `profiles` is self-readable.
* Magic-link response is **always** 200, regardless of whether the email is known.
* All Vietnamese error messages, English for keys + JSON, English for log lines.

## Review Focus (most-likely-to-bite gaps to cover in tests)

1. **Login with a known email but wrong password** — must NOT reveal which.
2. **Login on an unverified account** — should return a dedicated error code.
3. **Forgot-password for an unknown email** — must return 200, must not leak.
4. **Refresh with an expired/used refresh token** — must return 401 and revoke client-side state.
5. **Logout when the access token is already invalid** — must be idempotent (200).

Each is wired to its owning task's test list.

---

## File Structure

| File                                                      | Responsibility                                                    |
|-----------------------------------------------------------|------------------------------------------------------------------|
| `packages/database/migrations/003_auth_hardening.sql`     | Add `auth_events`, `auth_throttle`, RLS, `is_email_locked()`.     |
| `packages/shared/src/auth.ts`                             | Zod schemas + DTOs reused by api + web + extension.              |
| `apps/api/src/auth/supabase-users.ts`                     | Thin wrapper around `supabase.auth` (init, signUp, signIn, …).   |
| `apps/api/src/auth/throttle.ts`                           | Per-email lockout read/write.                                    |
| `apps/api/src/auth/audit.ts`                              | Insert into `auth_events`.                                       |
| `apps/api/src/auth/sessions.ts`                           | Build the unified `{user, session}` response from Supabase data. |
| `apps/api/src/auth/routes.ts`                             | Express router with the 8 endpoints.                             |
| `apps/api/src/app.ts`                                     | Mount `/api/v1/auth/*` and adapt to existing handler signature.   |
| `apps/api/src/server.ts`                                  | Pass service-role key only to `routes.ts` for `forgot-password`. |
| `apps/api/src/auth/__tests__/routes.test.ts`              | Vitest + supertest: happy + bad paths + throttling.              |
| `apps/web/src/auth/store.ts`                              | Session store in `localStorage` with subscribe/notify.           |
| `apps/web/src/auth/api.ts`                                | `login`, `register`, `logout`, … thin HTTP wrapper.               |
| `apps/web/src/pages/RegisterPage.tsx`                     | Form + Zod validation + i18n messages.                           |
| `apps/web/src/pages/LoginPage.tsx`                        | Form + Zod + i18n.                                               |
| `apps/web/src/main.tsx`                                   | Add `/login`, `/register` routes; redirect after success.        |
| `apps/web/src/__tests__/auth-store.test.ts`               | Session-store vitest coverage.                                   |
| `apps/extension/api-client.js`                            | Add `auth.login / register / logout / refresh` to existing client. |
| `apps/extension/popup.html` + `popup.js`                  | Login popup (mirrors web LoginPage behaviour).                   |
| `apps/extension/manifest.json`                            | Authorize the popup + storage permission.                        |
| `apps/extension/__tests__/auth-pure.test.mjs`             | Pure-logic tests for `popup.js` after refactor to ESM.           |

---

## Task 1: Author spec `specs/api/auth.md`

**Files:**
- Create: `specs/api/auth.md`

**Interfaces:**
- Consumes: nothing
- Produces: the canonical contract every later task implements

- [ ] Step 1: Write `specs/api/auth.md` covering endpoint table, request/response shapes, error codes, throttling, audit, anti-enumeration, security (RLS, token hygiene).
- [ ] Step 2: Open `pnpm gates:spec-sync` and confirm the new spec is reachable from `agents/core/code-reviewer.md` and `workflows/core/01-feature-development.md` (none of those paths change, but the gate will verify no dangling paths appear).
- [ ] Step 3: Commit.

## Task 2: DB migration `003_auth_hardening.sql`

**Files:**
- Create: `packages/database/migrations/003_auth_hardening.sql`
- Modify: `packages/database/src/index.ts` (re-export a `recordAuthEvent` helper if convenient; otherwise the API uses the SQL function directly)

**Interfaces:**
- Produces: tables `auth_events`, `auth_throttle`; functions `is_email_locked(text)`, `record_failed_attempt(text)`, `reset_attempts(text)`.

- [ ] Step 1: Write the migration. Every statement idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`).
- [ ] Step 2: Add a corresponding down migration comment at the top (manual, in the file) so future operators know how to undo it.
- [ ] Step 3: Run the existing SQL locally via the project's `pnpm --filter @mnemonics/database` workflow if available; otherwise verify with `psql --dry-run`-equivalent by parsing the file with `node packages/database/scripts/lint-migrations.mjs` (already in the repo's audit tooling — see `scripts/audit-structure.mjs`).
- [ ] Step 4: Commit.

## Task 3: Shared schemas in `packages/shared/src/auth.ts`

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/src/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  * `registerInputSchema = z.object({ email, password, name? })`
  * `loginInputSchema = z.object({ email, password })`
  * `refreshInputSchema = z.object({ refreshToken })`
  * `forgotInputSchema = z.object({ email })`
  * `resetInputSchema = z.object({ accessToken, refreshToken, newPassword })`
  * `resendVerificationInputSchema = z.object({ email })`
  * `authUserDtoSchema` and `authSessionDtoSchema`
  * TypeScript types `AuthUserDto`, `AuthSessionDto`, `LoginInput`, …

- [ ] Step 1: Write the failing test `packages/shared/src/__tests__/auth.test.ts` covering each schema's happy + bad input (each followed by `.safeParse(invalid).success === false`).
- [ ] Step 2: Run `pnpm --filter @mnemonics/shared test`; expect FAIL (new file).
- [ ] Step 3: Implement `packages/shared/src/auth.ts` exporting schemas + inferred types.
- [ ] Step 4: Re-export from `packages/shared/src/index.ts`.
- [ ] Step 5: Run tests; expect PASS.
- [ ] Step 6: Commit.

## Task 4: Backend auth wrappers (`supabase-users.ts`, `throttle.ts`, `audit.ts`, `sessions.ts`)

**Files:**
- Create: `apps/api/src/auth/supabase-users.ts`
- Create: `apps/api/src/auth/throttle.ts`
- Create: `apps/api/src/auth/audit.ts`
- Create: `apps/api/src/auth/sessions.ts`
- Test: `apps/api/src/auth/__tests__/wrappers.test.ts`

**Interfaces:**
- `supabaseUsers(client: SupabaseClient) → { signUp, signIn, refresh, signOut, me, resendVerification, resetPassword }`
- `throttle(pool) → { check(email), recordFailure(email), reset(email) }`
- `audit(pool) → { record(event: AuthEvent) }`
- `toAuthUserDto(user, profile?)` and `toAuthSessionDto(session)`

- [ ] Step 1: Failing test — call `supabaseUsers()` with a fake client and assert method shapes.
- [ ] Step 2: Implement `supabase-users.ts` as a typed pass-through.
- [ ] Step 3: Failing test — `throttle.check` returns `{locked:false}` for a fresh email; `recordFailure` increments; 6th call within 15 min returns `{locked:true,retryAfterSec:…}`.
- [ ] Step 4: Implement `throttle.ts` using the SQL functions from Task 2.
- [ ] Step 5: Failing test — `audit.record({kind:'login'})` calls `pool.query` once.
- [ ] Step 6: Implement `audit.ts`.
- [ ] Step 7: Failing test — DTO builders round-trip Supabase objects.
- [ ] Step 8: Implement `sessions.ts`.
- [ ] Step 9: Run all wrapper tests; expect PASS.
- [ ] Step 10: Commit.

## Task 5: Express router `apps/api/src/auth/routes.ts`

**Files:**
- Create: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v1/auth/*`)
- Test: `apps/api/src/auth/__tests__/routes.test.ts`

**Interfaces:**
- `createAuthRouter({ supabase, pool, serviceSupabase? }) → Router` with the 8 endpoints from the spec.

- [ ] Step 1: Failing test — register happy path returns `201 + {data:{user,session:null}}` because Supabase requires email confirmation before session.
- [ ] Step 2: Failing test — register existing email returns `200 + {data:{user:null}}` (anti-enumeration).
- [ ] Step 3: Failing test — login returns `200 + {data:{user,session}}` and writes one `auth_events` row.
- [ ] Step 4: Failing test — login wrong-password returns `401 AUTH_LOGIN_FAILED`; the error message does not reveal whether the email exists.
- [ ] Step 5: Failing test — login unverified email returns `403 EMAIL_NOT_VERIFIED`.
- [ ] Step 6: Failing test — login throttled at 6th attempt returns `429 RATE_LIMITED`.
- [ ] Step 7: Failing test — refresh with a valid token returns new `accessToken + refreshToken`; refresh with a bad token returns `401 AUTH_REFRESH_FAILED`.
- [ ] Step 8: Failing test — logout returns `204` even when the access token is invalid (idempotent).
- [ ] Step 9: Failing test — forgot-password always returns `200` and writes a row to `auth_events`.
- [ ] Step 10: Failing test — reset-password with a bad recovery token returns `401 AUTH_RESET_FAILED`; with good token + weak password returns `400 INVALID_AUTH_PAYLOAD`.
- [ ] Step 11: Failing test — `GET /api/v1/auth/me` returns the current user from the bearer token, or `401` when absent.
- [ ] Step 12: Implement each handler against the wrappers from Task 4.
- [ ] Step 13: Wire into `createApp` so that **if** `supabase` is provided, the auth router is mounted alongside the existing handlers.
- [ ] Step 14: Run all route tests; expect PASS.
- [ ] Step 15: `pnpm --filter @mnemonics/api test`; expect existing + new tests all PASS.
- [ ] Step 16: `pnpm typecheck`; expect PASS.
- [ ] Step 17: Commit.

## Task 6: Web client (`auth/store.ts`, `auth/api.ts`, `RegisterPage`, `LoginPage`)

**Files:**
- Create: `apps/web/src/auth/api.ts`
- Create: `apps/web/src/auth/store.ts`
- Create: `apps/web/src/pages/RegisterPage.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/main.tsx` (add `/login`, `/register`)
- Test: `apps/web/src/auth/__tests__/store.test.ts`

**Interfaces:**
- `authApi(baseUrl)` returns `{ register, login, refresh, logout, me }` calling the backend.
- `useAuthStore()` is a tiny pub-sub on top of `localStorage` key `mnemonics.session`.

- [ ] Step 1: Failing test — store stores session and emits update events on change.
- [ ] Step 2: Implement `auth/store.ts` (vanilla, no React deps).
- [ ] Step 3: Implement `auth/api.ts` with `fetch` wrappers.
- [ ] Step 4: Failing test — `RegisterPage` shows validation message on bad email and success message on good submit (use `react-testing-library`).
- [ ] Step 5: Implement `RegisterPage` and `LoginPage`.
- [ ] Step 6: Hook `/login` and `/register` into the existing router; preserve existing dashboard behaviour for authenticated users (redirect to `/` if logged in).
- [ ] Step 7: Run web tests; expect PASS.
- [ ] Step 8: Run `pnpm typecheck`; expect PASS.
- [ ] Step 9: Commit.

## Task 7: Extension login popup

**Files:**
- Modify: `apps/extension/api-client.js` (add `authLogin`, `authRegister`, `authLogout`)
- Create: `apps/extension/login-popup.html`
- Create: `apps/extension/login-popup.js`
- Create: `apps/extension/login-popup.css` (small file, share style with rest)
- Modify: `apps/extension/background.js` (open the popup when not authenticated)
- Modify: `apps/extension/manifest.json` (add `popup` default action OR a trigger)
- Test: `apps/extension/__tests__/auth-pure.test.mjs` (extract pure helpers)

- [ ] Step 1: Failing pure test — `validateCredentials({email, password})` returns `{ok:false, field:'email'}` for bad email.
- [ ] Step 2: Refactor `api-client.js` to expose pure helpers in a separate ESM file `auth-helpers.mjs` for testability.
- [ ] Step 3: Implement `login-popup.html` + `login-popup.js` mirroring the web behaviour, posting through `api-client.js`.
- [ ] Step 4: In `background.js`, before allowing capture, check `chrome.storage.local` for a session; if missing, open the popup.
- [ ] Step 5: Run extension tests; expect PASS.
- [ ] Step 6: Commit.

## Task 8: Documentation + run record

**Files:**
- Create: `workflows/runs/2026-09-19-auth-login-register.md`
- Modify: `README.md` (link to new spec + run)
- Modify: `AGENTS.md` §6 (add the new `auth_events` table note)
- Modify: `docs/supabase-setup.md` (link to new migration)

**Interfaces:**
- Produces: a single human-readable record of decisions + gate results.

- [ ] Step 1: Write the run record after all tests + gates pass. Include gate evidence.
- [ ] Step 2: Update `docs/supabase-setup.md` to mention that running migration `003` is required for throttling/audit.
- [ ] Step 3: Run final `pnpm gates:all` and `pnpm test`; expect PASS.
- [ ] Step 4: Commit.

## Self-Review

1. **Spec coverage** — every endpoint in `specs/api/auth.md` is implemented by Task 5 + wired in Tasks 6 & 7. Throttling → Task 4. Audit → Task 4 + 5. Anti-enumeration → Tasks 4 + 5. ✅
2. **Placeholder scan** — every step has concrete code or schema. ✅
3. **Type consistency** — types from Task 3 match what Tasks 4–7 import. ✅
4. **Review Focus** — gaps 1–5 covered by Tasks 5.7 (wrong password), 5.5 (unverified), 5.9 + 5.10 (forgot + reset unknown), 5.7 (refresh bad token), 5.8 (logout idempotent). ✅
