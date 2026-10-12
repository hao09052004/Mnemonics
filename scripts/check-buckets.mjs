/**
 * List storage buckets via the service-role key.
 * Required environment:
 *   SUPABASE_URL                  e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service-role JWT
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('SUPABASE_URL is not configured.');
  process.exit(1);
}
if (!SERVICE_ROLE) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  process.exit(1);
}

const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
  headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }
});
const data = await r.json();
console.log(JSON.stringify(data, null, 2));
