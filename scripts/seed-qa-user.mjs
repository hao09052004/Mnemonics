/**
 * Create a verified Supabase user for QA testing of the auth facade.
 * Uses the service-role admin endpoint so we bypass email verification and
 * avoid the IP-level rate limit on /auth/v1/signup.
 */
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = 'https://jtmowwtmjtmceihzvreu.supabase.co';
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0bW93d3RtanRtY2VpaHp2cmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTY5OTU1NSwiZXhwIjoyMTA1Mjc1NTU1fQ.qR4sYBGCorwywXdfXgxMUSjpAIs4ELnirhgwpB63FPQ';
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
