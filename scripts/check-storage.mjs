/**
 * Smoke test for an object in the `mnemonics-assets` bucket.
 * Required environment:
 *   SUPABASE_URL                  e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service-role JWT
 *   CHECK_STORAGE_KEY             storage object key (defaults to a known demo path)
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const key = process.env.CHECK_STORAGE_KEY ||
  '70e43667-aa41-4e90-ba4b-a343e41e4b30/9892afb2-a4df-4452-9c0d-71620f15ad9a/pixel.png';

if (!SUPABASE_URL) {
  console.error('SUPABASE_URL is not configured.');
  process.exit(1);
}
if (!SERVICE_ROLE) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  process.exit(1);
}

const url = `${SUPABASE_URL}/storage/v1/object/authenticated/mnemonics-assets/${encodeURIComponent(key)}`;
const r = await fetch(url, { method: 'GET', headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } });
const body = await r.text();
console.log('GET status =', r.status);
console.log('Content-Length =', r.headers.get('content-length'));
console.log('Content-Type   =', r.headers.get('content-type'));
console.log('Body           =', body.slice(0, 300));
