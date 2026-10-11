/**
 * bootstrap-admin.ts — promote a known Supabase user to `admin`.
 *
 * This is the ONLY public way to grant the `admin` role. There is
 * no HTTP route that promotes users. The script:
 *
 *  1. Reads `DATABASE_URL` (service-role pool — see migration 007).
 *  2. Reads `ADMIN_BOOTSTRAP_USER_ID` (a known Supabase auth.users
 *     UUID) and an optional `ADMIN_BOOTSTRAP_REASON`.
 *  3. Refuses to run unless the target user exists in `auth.users`.
 *  4. Refuses to demote the only remaining admin (last-admin guard).
 *  5. Updates `profiles.role = 'admin'` inside a transaction and
 *     inserts a `role_audit_log` row with `actor_user_id = NULL`
 *     (system bootstrap) and the reason.
 *
 * Dry-run by default. Set `ADMIN_BOOTSTRAP_APPLY=1` to commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: join(process.cwd(), '.env'), quiet: true });
config({ path: join(process.cwd(), '../../.env'), quiet: true });

const TARGET = process.env.ADMIN_BOOTSTRAP_USER_ID;
const REASON = process.env.ADMIN_BOOTSTRAP_REASON ?? 'bootstrap-admin CLI';
const APPLY = process.env.ADMIN_BOOTSTRAP_APPLY === '1';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[bootstrap-admin] DATABASE_URL is required');
  process.exit(2);
}
if (!TARGET) {
  console.error('[bootstrap-admin] ADMIN_BOOTSTRAP_USER_ID is required (a Supabase auth.users UUID)');
  process.exit(2);
}

const pool = createPool(DATABASE_URL);

async function main() {
  // 1. Confirm the user exists.
  const u = await pool.query<{ id: string; email: string | null }>(
    'SELECT id, email FROM auth.users WHERE id = $1',
    [TARGET]
  );
  if (u.rowCount === 0) {
    console.error(`[bootstrap-admin] user ${TARGET} not found in auth.users`);
    process.exitCode = 2;
    return;
  }
  const userEmail = u.rows[0].email;

  // 2. Read the current role.
  const p = await pool.query<{ role: 'user' | 'admin' }>(
    'SELECT role FROM profiles WHERE id = $1',
    [TARGET]
  );
  const currentRole = p.rows[0]?.role ?? 'user';
  if (currentRole === 'admin') {
    console.log(`[bootstrap-admin] user ${userEmail ?? TARGET} is already admin — nothing to do`);
    return;
  }

  // 3. Last-admin guard (only matters for demotions; we never demote
  //    here, but we still surface the count to the operator).
  const adminCount = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM profiles WHERE role = 'admin'"
  );
  const admins = Number.parseInt(adminCount.rows[0]?.n ?? '0', 10);

  // 4. Mirror `app_metadata.role = 'admin'` on the Supabase user.
  //    This is best-effort: the API will reconcile on the next
  //    authenticated request. We use the service-role pool here
  //    so the auth schema write is allowed.
  if (APPLY) {
    await pool.query('BEGIN');
    try {
      await pool.query(
        "UPDATE profiles SET role = 'admin', updated_at = NOW() WHERE id = $1",
        [TARGET]
      );
      await pool.query(
        `INSERT INTO role_audit_log (actor_user_id, target_user_id, old_role, new_role, reason)
         VALUES (NULL, $1, $2, 'admin', $3)`,
        [TARGET, currentRole, REASON]
      );
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    // Best-effort mirror.
    try {
      await pool.query(
        "UPDATE auth.users SET app_metadata = COALESCE(app_metadata, '{}'::jsonb) || jsonb_build_object('role','admin') WHERE id = $1",
        [TARGET]
      );
    } catch (e) {
      console.warn('[bootstrap-admin] app_metadata mirror failed (non-fatal):', (e as Error).message);
    }
    console.log(
      JSON.stringify({
        applied: true,
        target_user_id: TARGET,
        target_email: userEmail,
        old_role: currentRole,
        new_role: 'admin',
        reason: REASON,
        admins_after: admins + 1
      }, null, 2)
    );
  } else {
    console.log(
      JSON.stringify({
        dry_run: true,
        target_user_id: TARGET,
        target_email: userEmail,
        old_role: currentRole,
        new_role: 'admin',
        reason: REASON,
        admins_after: admins + 1,
        to_apply: "Set ADMIN_BOOTSTRAP_APPLY=1 to commit"
      }, null, 2)
    );
  }
}

try {
  await main();
} catch (e) {
  console.error('[bootstrap-admin] failed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

// Re-export so the script is tree-shakable when imported by tests.
export { };
void readFileSync; // keep import non-empty
