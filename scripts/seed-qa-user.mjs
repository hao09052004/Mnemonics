/**
 * Create a verified Supabase user for QA testing of the auth facade.
 * Uses the service-role admin endpoint so we bypass email verification and
 * avoid the IP-level rate limit on /auth/v1/signup.
 *
 * Required environment:
 *   SUPABASE_URL                  e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service-role JWT
 *
 * Hardcoded service-role credentials were removed after a P0
 * secret-exposure incident. The previously committed key is
 * considered compromised; this script fails fast when the env
 * variables are missing rather than carrying a fallback.
 */
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('SUPABASE_URL is not configured.');
  console.error('Set it before running, e.g.:');
  console.error('  SUPABASE_URL=https://<project>.supabase.co node scripts/seed-qa-user.mjs');
  process.exit(1);
}
if (!SERVICE_ROLE) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  console.error('Set it before running, e.g.:');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<jwt> node scripts/seed-qa-user.mjs');
  process.exit(1);
}

const PASSWORD = 'MnemonicsDev#2026';
const email = `mnemo+${Date.now()}@protonmail.com`;

const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ email, password: PASSWORD, email_confirm: true })
});

const text = await response.text();
if (!response.ok) {
  console.error('Failed to create user:', response.status, text);
  process.exit(1);
}

const created = JSON.parse(text);
console.log('OK created user', created.id);
console.log('EMAIL     =', email);
console.log('PASSWORD  =', PASSWORD);
console.log('USER_ID   =', created.id);
console.log('CONFIRMED =', Boolean(created.email_confirmed_at));
