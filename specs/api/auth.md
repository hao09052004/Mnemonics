# API: auth

> Owner: backend (`apps/api/src/auth/*`). Source-of-truth for any code path
> touching login, register, password reset, session refresh, or logout.
> Spec from brainstorming brief: `../../../specs/plans/2026-09-19-auth-brainstorm.md`.
> Plan: `../../../specs/plans/2026-09-19-auth-login-register.md`.

This spec extends, **without breaking**, the existing endpoints
`/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/me` already
implemented in `apps/api/src/app.ts`. The new endpoints add refresh, logout,
forgot-password, reset-password, and resend-verification.

## 1. Endpoints

| Method | Path                                  | Auth                | Body                                          | Response                                                |
|--------|---------------------------------------|---------------------|-----------------------------------------------|---------------------------------------------------------|
| POST   | `/api/v1/auth/register`               | none                | `{email,password,name?}`                      | `200` if email exists, `201` if new; `{user,session?}`  |
| POST   | `/api/v1/auth/login`                  | none                | `{email,password}`                            | `200` `{user,session}`; `401`/`403`/`429` on failure   |
| POST   | `/api/v1/auth/refresh`                | bearer (refresh)    | `{refreshToken}`                              | `200` `{user,session}`; `401 AUTH_REFRESH_FAILED`       |
| POST   | `/api/v1/auth/logout`                 | bearer              | none                                          | `204`; idempotent (even with invalid token)             |
| POST   | `/api/v1/auth/forgot-password`        | none                | `{email}`                                     | `200` always (anti-enumeration)                         |
| POST   | `/api/v1/auth/reset-password`         | none                | `{accessToken,refreshToken,newPassword}`      | `200` `{user,session}`; `400` weak pw; `401` bad token  |
| POST   | `/api/v1/auth/resend-verification`    | bearer              | none                                          | `204`; idempotent                                        |
| GET    | `/api/v1/auth/me`                     | bearer              | —                                             | `200` `{user}`; `401`                                   |

### Cross-cutting

* `Content-Type: application/json` everywhere.
* Auth header: `Authorization: Bearer <accessToken>` (or `<refreshToken>` on
  the refresh endpoint).
* All requests are tenant-isolated via Supabase RLS on `profiles` and downstream
  tables; the API never bypasses RLS for the user-facing flow.
* The API uses `SUPABASE_SERVICE_ROLE_KEY` *only* to call
  `supabase.auth.admin.generateLink({type:'recovery', email})` for
  forgot-password. All other user operations use the **anon** client with the
  caller's bearer token.

## 2. Common request validation

| Field        | Rule                                                                  |
|--------------|-----------------------------------------------------------------------|
| `email`      | RFC 5322, lowercase normalised, ≤ 254 chars                           |
| `password`   | ≥ 10 chars, at least one digit, one lowercase, one uppercase, one symbol; **never** echoed back |
| `name`       | optional, ≤ 80 chars, trimmed, no control chars                       |
| `newPassword`| same rules as `password`                                              |
| `refreshToken` / `accessToken` | opaque JWT; we do not parse them at the API level |

Bad inputs return `400 INVALID_AUTH_PAYLOAD` with `requestId`.

## 3. Common response shape

```jsonc
{
  "data": {
    "user": {
      "id":            "uuid",
      "email":         "user@example.com",
      "name":          "Trang" | null,
      "role":          "user" | "admin",
      "emailVerified": true
    },
    "session": {
      "accessToken":  "jwt",
      "refreshToken": "jwt",
      "expiresAt":    1700000000,    // epoch seconds
      "tokenType":     "bearer"
    }
  }
}
```

`session` is **null** when Supabase returns no session yet (e.g. register with
email verification required). Clients must handle that case and show a
"check your inbox" message.

## 4. Error envelope

```jsonc
{
  "error": {
    "code":      "INVALID_AUTH_PAYLOAD | AUTH_NOT_CONFIGURED | AUTH_LOGIN_FAILED | AUTH_REFRESH_FAILED | EMAIL_NOT_VERIFIED | RATE_LIMITED | WEAK_PASSWORD | AUTH_RESET_FAILED | INTERNAL_ERROR",
    "message":   "human-readable, in Vietnamese by default",
    "requestId": "uuid"
  }
}
```

HTTP status codes:

| Code | When                                                            |
|------|-----------------------------------------------------------------|
| 200  | OK on `register` (existing email) and `forgot-password`         |
| 201  | New account created                                             |
| 204  | Logout / resend-verification completed (idempotent)             |
| 400  | Bad input                                                       |
| 401  | Bad credentials, expired/invalid refresh or reset token         |
| 403  | Email not verified yet                                          |
| 429  | Rate-limited (per `auth_throttle`)                              |
| 5xx  | Anything else; `requestId` returned for debugging                |

The 4xx codes **never** leak whether the email exists. `EMAIL_NOT_VERIFIED`
is the only situation where the email is implicitly confirmed; we accept
that because the user just typed it in.

## 5. Anti-enumeration

| Endpoint              | Same response regardless of email existence?                |
|-----------------------|-------------------------------------------------------------|
| register              | **200** `{user:null,session:null}` if email already exists |
| login                 | No — it returns the user, by design                         |
| forgot-password       | **Yes — always 200**                                        |

For register, if the email exists we log to `auth_events` with kind=`register_duplicate_email`
and return a payload identical in shape to a new registration. No email is sent.

For login, the standard failure is `401 AUTH_LOGIN_FAILED`, single message
for "wrong password", "user not found", and "user disabled" — the only
differentiator is `EMAIL_NOT_VERIFIED` (status 403, separately audited).

## 6. Throttling (`auth_throttle` table)

* 5 failed attempts within 15 min per email ⇒ `locked_until = NOW() + 15 min`.
* Applies to `login` (failures count) and `forgot-password` (failures count,
  not lockout — just slow-down).
* `register` is **not** throttled per-email; the spec lets supabase handle
  its own anti-abuse for sign-up.
* Successful `login` / `forgot-password` MUST reset the counter
  (`reset_attempts(email)`).
* On lockout, respond `429 RATE_LIMITED` with `Retry-After` (seconds).

## 7. Audit (`auth_events` table)

Every endpoint writes exactly one row per call (not per Supabase retry):

| Column        | Type           | Notes                                          |
|---------------|----------------|------------------------------------------------|
| `id`          | uuid PK        |                                                |
| `user_id`     | uuid nullable  | from `auth.uid()` once login succeeds          |
| `email_attempted` | text        | always; empty only on logout                    |
| `kind`        | enum           | `register | register_duplicate_email | login | login_failed | login_locked | refresh | refresh_failed | logout | forgot_password | reset_password | resend_verification` |
| `ip`          | inet           |                                                |
| `user_agent`  | text           |                                                |
| `request_id`  | uuid           |                                                |
| `created_at`  | timestamptz    | default `now()`                                |

Policy: `auth_events` is admin-readable only. No client ever queries it.

## 8. Security guarantees

1. **No token leaves the server's response** other than as JSON. No headers,
   no cookies, no URL params.
2. The API only reads `SUPABASE_SERVICE_ROLE_KEY` once at boot, inside
   `apps/api/src/auth/supabase-users.ts`. No other code path touches it.
3. `accessToken` / `refreshToken` are never logged. The audit table stores
   `request_id` only.
4. All input is zod-validated; untrusted payloads do not reach Supabase.
5. Passwords are never logged and never persisted anywhere except inside
   Supabase Auth.
6. RLS on `profiles` is **self-readable**, **trigger-writable**; no client
   can mutate their own row.

## 9. RLS implications

* The `profiles` policy is unchanged: each user can `SELECT` their own row,
  trigger inserts on signup. Admin promotion is via SQL only.
* `auth_events`: admin `SELECT` only.
* `auth_throttle`: no client access; we expose two RPC functions
  (`is_email_locked`, `record_failed_attempt`, `reset_attempts`) that the
  service-role client calls on behalf of the user.

## 10. Versioning

The endpoint family is versioned by URL (`/api/v1/auth/*`). Adding a
breaking field is an ADR. Adding a new endpoint is a normal PR.

## 11. See also

* Plan: [`../../../specs/plans/2026-09-19-auth-login-register.md`](../../../specs/plans/2026-09-19-auth-login-register.md)
* DB schema: [`../../../specs/data/supabase-schema.md`](../../../specs/data/supabase-schema.md)
* ADR (forthcoming): [`../../../specs/adr/0005-auth-architecture.md`](../../../specs/adr/0005-auth-architecture.md)
