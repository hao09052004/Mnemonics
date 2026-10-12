/**
 * Reproduce a public /auth/v1/signup call to debug the auth facade.
 * Required environment:
 *   SUPABASE_URL       e.g. https://<project>.supabase.co
 *   SUPABASE_ANON_KEY  the public anon JWT (NOT the service-role key)
 *
 * Note: the anon key is the only Supabase credential this script is
 * allowed to use. It must not be substituted with the service-role
 * key — that is exactly the mistake this cleanup is meant to prevent.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('SUPABASE_URL is not configured.');
  process.exit(1);
}
if (!ANON) {
  console.error('SUPABASE_ANON_KEY is not configured.');
  process.exit(1);
}

const email = `repro+${Date.now()}@gmail.com`;

const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'StrongPass#2026', data: { name: 'Repro' } })
});
const text = await r.text();
console.log('status =', r.status);
console.log(text);
console.log('EMAIL =', email);
