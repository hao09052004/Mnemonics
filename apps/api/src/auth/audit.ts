import type { Pool, PoolClient } from 'pg';

export type AuthEventKind =
  | 'register'
  | 'register_duplicate_email'
  | 'register_failed'
  | 'login'
  | 'login_failed'
  | 'login_locked'
  | 'refresh'
  | 'refresh_failed'
  | 'logout'
  | 'forgot_password'
  | 'reset_password'
  | 'resend_verification';

export interface AuthEvent {
  kind: AuthEventKind;
  email?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface Audit {
  record(event: AuthEvent): Promise<void>;
}

type Executor = Pool | PoolClient;

export function createAudit(executor: Executor): Audit {
  return {
    async record({ kind, email, requestId, ip, userAgent }) {
      await executor.query(
        `SELECT public.record_auth_event($1, $2, $3, $4, NULLIF($5, '')::inet)`,
        [kind, email ?? null, requestId ?? null, userAgent ?? null, ip ?? null]
      );
    }
  };
}

/** Fallback audit used in tests — collects events in memory. */
export function createMemoryAudit(): Audit & { events: AuthEvent[] } {
  const events: AuthEvent[] = [];
  return {
    events,
    async record(event) { events.push(event); }
  };
}
