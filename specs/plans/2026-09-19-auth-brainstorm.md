# Brainstorm → Design Brief: Auth (login + register) across web / extension / api

> Skill invoked: `skills/core/brainstorming/SKILL.md`.
> Status: **awaiting human approval**. This is the design brief; the actual
> implementation plan lives in `../specs/plans/2026-09-19-auth-login-register.md`,
> which will be authored **after** you approve this brief.

## 1. Intent (back to you, in your words)

Make Mnemonics' three apps — web dashboard, browser extension, and capture API
— sit behind a single shared authentication experience. A user registers or
signs in once and is recognized the same way in all three; the system
remembers them; they can sign out; they can recover a forgotten password; and
the whole experience is hardened against the obvious abuse patterns
(brute-force, password spraying, account enumeration).

## 2. Constraints (the non-negotiables)

1. **Auth provider is `supabase.auth`** — no custom password hashing, no custom
   JWT issue/verify. Just call `signUp`, `signInWithPassword`,
   `signInWithOtp`, `resetPasswordForEmail`, `signOut`, `getUser`.
2. **All three apps reach auth.**
   * `apps/api` proxies select endpoints (`/api/v1/auth/*`) and *also* issues
     the RLS-respecting JWT to whoever calls `/api/v1/captures/*`.
   * `apps/web` is the most polished — full pages, validation, sessions.
   * `apps/extension` is a tiny popup that POSTs to the API and stores the
     issued `access_token` + `refresh_token` in `chrome.storage.local`.
3. **`profiles` table** (`packages/database/migrations/002_create_profiles.sql`)
   is the source of truth for `name`, `role`, and is **already wired** to
   `auth.users` via a `SECURITY DEFINER` trigger. We do not duplicate this.
4. **Never expose `SUPABASE_SERVICE_ROLE_KEY` to a client.** It only ever
   lives in `apps/api` server-side; the web/extension clients only ever see
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. **Full hardening**: throttling, anti-enumeration, audit log, RLS on
   profiles, magic-link fallback, refresh, logout, password reset.

## 3. Assumptions (please correct if any are wrong)

* Register flow is **email + password**, not social/OAuth. (Magic-link is the
  recovery path, not an alternative to password.)
* Email verification is **required** before a user can hit
  `/api/v1/captures` for the first time. Unverified users get a `202 + email
  not verified` hint, not a `403`.
* Tenant model does not exist yet; the current MVP is **single-tenant per
  user-account**. We will *not* introduce a `tenants` table in this slice.
* Sessions are JWT (`access_token` 1 h, `refresh_token` 30 d). We do **not**
  introduce server-side session stores. The refresh endpoint exchanges the
  refresh token for a fresh pair using `supabase.auth.refreshSession`.

## 4. The API surface we will own

| Method | Path                                | Purpose                                              | Auth          |
|--------|-------------------------------------|------------------------------------------------------|---------------|
| POST   | `/api/v1/auth/register`             | Create account                                       | none          |
| POST   | `/api/v1/auth/login`                | Email + password sign-in                             | none          |
| POST   | `/api/v1/auth/refresh`              | Rotate access token using refresh token              | bearer        |
| POST   | `/api/v1/auth/logout`               | Invalidate refresh token; drop server-side session   | bearer        |
| POST   | `/api/v1/auth/forgot-password`      | Send reset email; always 200 (anti-enumeration)      | none          |
| POST   | `/api/v1/auth/reset-password`       | Exchange recovery token for a new password pair      | none          |
| POST   | `/api/v1/auth/resend-verification`  | Re-send confirmation email                          | bearer (user) |
| GET    | `/api/v1/auth/me`                   | Current profile (id/email/name/role/email_verified) | bearer        |

> `/api/v1/captures*` is **unchanged**; it already uses
> `requireSupabaseAuth`. We just make sure the JWT it receives is issued by
> the very same endpoint family.

## 5. The data shape that comes back

```jsonc
{
  "data": {
    "user": {
      "id":           "uuid",
      "email":        "user@example.com",
      "name":         "string|null",
      "role":         "user|admin",
      "emailVerified": true
    },
    "session": {
      "accessToken":  "jwt",
      "refreshToken": "jwt",
      "expiresAt":    1700000000,    // epoch seconds
      "tokenType":    "bearer"
    }
  }
}
```

Errors use the existing envelope:

```jsonc
{
  "error": {
    "code":    "INVALID_AUTH_PAYLOAD | AUTH_LOGIN_FAILED | AUTH_NOT_CONFIGURED | RATE_LIMITED | EMAIL_NOT_VERIFIED | …",
    "message": "human-readable, in Vietnamese by default",
    "requestId": "uuid"
  }
}
```

## 6. The data we add on top of Supabase

A single SQL migration, `packages/database/migrations/003_auth_hardening.sql`:

* `auth_events (id, user_id?, email_attempted?, kind, ip, user_agent, created_at)`
  with RLS that **only admins can read**.
* `auth_throttle (email_attempted text PK, attempts int, first_attempt_at, locked_until)`
  for per-email throttling on `login` and `forgot-password`.
* One Postgres function `is_email_locked(email)` consulted by the API.
* The `profiles` policy is tightened: a user can **read** their own row, an
  admin can read all; only the trigger inserts rows (no client-side
  INSERT/UPDATE on `profiles`).

No schema drift — the existing `001_create_items.sql` and
`002_create_profiles.sql` are untouched.

## 7. Non-obvious things we will do

1. **Anti-enumeration**: `register` returns `200 {data: {user: null}}` if the
   email is already taken, while internally logging the attempt and *not*
   calling `signUp` a second time. `forgot-password` always returns `200`
   regardless of whether the email exists.
2. **Throttling**: 5 failed `/login` attempts within 15 min per email ⇒
   15 min cooldown. Same window for `forgot-password` (without account
   lockout — we just slow down delivery).
3. **Audit log**: every register / login / refresh / logout / reset request
   writes one row to `auth_events`. We never log tokens, only
   `request_id`, kind, ip, user-agent, and the email attempt.
4. **Refresh rotation**: the `/refresh` endpoint rotates the refresh token
   on every call and invalidates the previous one in Supabase's
   `auth.refresh_token` table — Supabase's behaviour, we just expose it.
5. **No key in client bundle**: extension popup and web both read
   `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only.
   `service_role` is reachable **only** at `apps/api/server.ts` and even
   there is **only** used for storage uploads, never for user-facing
   queries.
6. **Coverage**: every new endpoint ships with at least three vitest cases —
   happy path, invalid input, and one failure mode (rate-limit, bad
   password, expired token). The runner is `pnpm --filter @mnemonics/api
   test`.

## 8. Anti-patterns we will reject in code review

* Storing the password **anywhere** in the client.
* Logging `access_token` or `refresh_token` to stdout.
* Returning distinct HTTP codes for "user exists" vs "wrong password".
* Letting the extension bypass `/api/v1/auth/*` and call Supabase directly
  with the service role (the extension never sees it).
* Running migrations from app boot — they run from
  `docs/supabase-setup.md`'s SQL editor path only.

## 9. What this slice does **not** include

* OAuth providers.
* MFA / WebAuthn.
* Per-tenant isolation (out of scope per §3).
* Server-side session storage / revocation lists beyond what Supabase offers.
* A UI for admin role promotion (handled via SQL per `docs/supabase-setup.md`).

## 10. What I need from you

**Approve or correct this brief.** Specifically:
* Are the 8 assumptions in §3 right?
* Are the 8 endpoints in §4 the right set?
* Is the `auth_events` + `auth_throttle` schema the right balance for MVP?
* Anything to drop from §9's "not included" list because it's actually needed?

If everything is fine, reply `go` (or your Vietnamese equivalent), and I'll
author `specs/plans/2026-09-19-auth-login-register.md` + run the rest of the
workflow.
