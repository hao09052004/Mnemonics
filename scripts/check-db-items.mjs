// Login + count items to verify context-menu saves are landing in DB.
const SUPABASE_URL = 'http://localhost:8000';
const API_URL = 'http://localhost:4000';
const DEV_TOKEN = 'mnemonics-dev-token';

async function main() {
  // We need a real access token tied to a user_id. Easiest: hit dev token
  // exchange or call /me. The API uses the token to derive userId — let's
  // see what /api/v1/me returns for the dev token.

  const me = await fetch(API_URL + '/api/v1/me', {
    headers: { Authorization: 'Bearer ' + DEV_TOKEN }
  }).then(r => r.json()).catch(e => ({ error: String(e) }));
  console.log('GET /me ->', JSON.stringify(me));

  // Try the items list
  const items = await fetch(API_URL + '/api/v1/items?limit=20', {
    headers: { Authorization: 'Bearer ' + DEV_TOKEN }
  }).then(r => r.json()).catch(e => ({ error: String(e) }));
  console.log('GET /items ->', JSON.stringify(items).slice(0, 2000));
}
main();
