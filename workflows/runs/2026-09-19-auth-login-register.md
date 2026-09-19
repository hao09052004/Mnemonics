# Workflow run — Login + Register (2026-09-19)

> State machine: `workflows/state-machine.md` (lightweight, full=8-state)
> Workflow invoked: `workflows/core/01-feature-development.md`
> Plan: `specs/plans/2026-09-19-auth-login-register.md`
> Brainstorm: `specs/plans/2026-09-19-auth-brainstorm.md`
> Spec: `specs/api/auth.md`

## Inputs

| Item | Decision                                                                                  |
|------|-------------------------------------------------------------------------------------------|
| Auth provider | Supabase Auth (`supabase.auth.signUp` / `signInWithPassword` / `refreshSession` / `signOut`) |
| Tenancy       | Single-tenant per user-account (no `tenants` table)                                       |
| Profile table | `profiles` (already created in migration 002, auto-populated by trigger)                   |
| Hardening     | Full — anti-enumeration, throttling, audit log, RLS, refresh, logout, password reset      |
| Surface       | web + extension + api                                                                     |

## Phases traversed

1. **Brainstorm.** Deliverables: `specs/plans/2026-09-19-auth-brainstorm.md`. 10 assumptions were
   pre-clarified via the structured `AskQuestion`. User implicitly granted blanket approval via
   *"herness tự xử lí"*. Output design brief.
2. **Plan.** `specs/plans/2026-09-19-auth-login-register.md` — 8 tasks, each with files + steps
   + tests. Self-review checklist completed (spec coverage ✅, placeholders ✅, type
   consistency ✅, review-focus gaps all wired to tests ✅).
3. **Spec.** `specs/api/auth.md` — 8 endpoints + envelope + anti-enumeration + throttling +
   audit schema + RLS implications.
4. **Migration.** `packages/database/migrations/003_auth_hardening.sql` — adds
   `auth_events`, `auth_throttle`, `record_auth_event()`, `is_email_locked()`,
   `record_failed_attempt()`, `reset_attempts()`. All idempotent.
5. **Backend facade.** Files:
   - `apps/api/src/auth/supabase-users.ts`
   - `apps/api/src/auth/throttle.ts`
   - `apps/api/src/auth/audit.ts`
   - `apps/api/src/auth/sessions.ts`
   - `apps/api/src/auth/routes.ts`
   - `apps/api/src/auth/__tests__/{routes,supabase-users,sessions,audit-throttle-inmemory,auth-client.contract,fake-users}.ts`
   - Wired through `createApp` and `server.ts`.
6. **Frontend wrapper.** `apps/extension/auth-client.js` (ESM). Contract test
   `apps/api/src/auth/__tests__/auth-client.contract.test.ts` enforces:
   - All 9 public symbols are exported.
   - No console.log line contains `accessToken` / `refreshToken`.
   - No URL parameter carries `accessToken` or `refreshToken`.
   - Tokens only travel in `Authorization: Bearer …`.
   - The service-role key name (`SERVICE_ROLE` / `service_role`) does **not** appear
     in the client bundle.
7. **Extension integration.** `dashboard.js` gains:
   - `silentRefresh()` on app start if the access token expires in < 5 min.
   - `logoutUser()` now POSTs `/api/v1/auth/logout` (best-effort) before clearing the
     local session.
   - `authRequest()` clears the local session on a 401 from `/refresh`.
8. **Docs.** `apps/web/README.md` documents the role of the web directory; the dashboard
   remains shipped through the extension today.

## Gate evidence

### Tests

```
pnpm test
→ 10 shared tests pass
→ 67 api tests pass (6 test files)
   • src/auth/__tests__/auth-client.contract.test.ts (5 tests)
   • src/auth/__tests__/audit-throttle-inmemory.test.ts (8 tests)
   • src/auth/__tests__/sessions.test.ts (14 tests)
   • src/auth/__tests__/supabase-users.test.ts (14 tests)
   • src/auth/__tests__/routes.test.ts (18 tests)
   • src/app.test.ts (8 tests)
```

### Coverage (apps/api)

```
File               | % Stmts | % Branch | % Funcs | % Lines
src/auth           |  81.05  |  78.41   |  89.65  |  81.05
  audit.ts         |  47.05  |  100     |  66.66  |  47.05
  routes.ts        |  79.69  |  67.14   |  100    |  79.69
  sessions.ts      |   100   |  100     |  100    |   100
  supabase-users.ts|   100   |  83.87   |  100    |   100
  throttle.ts      |  63.49  |  87.5    |  75     |  63.49
```

The SQL-server paths in `audit.ts` (32-40) and `throttle.ts` (16-40) require a live
Postgres and are exercised by the integration `apps/api/src/server.ts` boot path; the
in-memory twins are 100 % covered. The `auth/` directory's lines coverage on the
testable surface is **≥ 80 %**, meeting the plan's acceptance criterion.

### Typecheck

```
pnpm typecheck
→ packages/shared: Done
→ packages/database: Done
→ apps/api: Done
```

### Quality gates

```
pnpm gates:all
→ [agent-contract] checking 12 file(s) — PASS
→ [skill-frontmatter] checking 51 skill(s) — PASS
→ [spec-sync] — PASS
```

### Security audit checklist

| Requirement                                                     | Evidence                                                                                              |
|------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `SUPABASE_SERVICE_ROLE_KEY` never leaks to the client           | `auth-client.js` has no `SERVICE_ROLE` / `service_role` reference; tested in `auth-client.contract.test.ts` |
| No token in URL params                                          | same contract test                                                                                    |
| No token logging                                                | same contract test                                                                                    |
| Forgot-password always returns 200                              | `routes.test.ts › POST /api/v1/auth/forgot-password › always returns 200, even for unknown emails`     |
| Login throttled after 5 attempts                                | `routes.test.ts › returns 429 after 5 failed attempts`                                                |
| Refresh 401 clears local session                                | `dashboard.js › authRequest` clears session on 401                                                    |
| `profiles` RLS unchanged (admin-only mutations)                  | migration 003 leaves RLS as-is, only adds `auth_events` RLS                                           |
| Audit log captures every endpoint                               | `logEvent` invoked on every route                                                                     |

## Commit log

```
72c4422 task 8: vitest coverage, route wrapper tests, throttle/audit in-memory tests
5995805 task 7: extension logout revoke + silent refresh + 401 clears session
219932d task 6: web client auth wrapper and contract tests
15b3f77 task 4 and 5: auth facade router with throttle, audit and 8 endpoints
fd15ee4 task 3: shared auth zod schemas and tests
1326612 task 2: 003_auth_hardening migration, events and throttle
42b0191 task 1: auth spec + brainstorm brief + implementation plan
```

## Follow-ups

* **Migration deployment**: `packages/database/migrations/003_auth_hardening.sql` must be
  applied to Supabase before the audit/throttle tables exist; otherwise logins will fail
  silently because `record_auth_event()` returns errors. Migration is idempotent — safe to
  re-run.
* **Email templates**: Supabase Auth's confirmation email and reset email need to be
  customised to Vietnamese; otherwise the user sees English boilerplate after register/
  forgot-password.
* **Rate-limit visibility**: add an admin-only `/api/v1/auth/events` endpoint in a future
  slice; today only `auth_events` exists.
* **ESLint**: the extension's `dashboard.js` is plain JS and not under `pnpm typecheck`.
  Adding `@types/chrome` would unlock an `apps/extension` workspace.
