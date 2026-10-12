const BASE = 'http://localhost:4000/api/v1/auth';
const email = 'mnemo+1789824063468@protonmail.com';
const password = 'MnemonicsDev#2026';

const res = await fetch(`${BASE}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const text = await res.text();
const json = text ? JSON.parse(text) : null;
console.log('login status =', res.status);
console.log(JSON.stringify(json, null, 2));

if (json?.data?.session?.accessToken) {
  const token = json.data.session.accessToken;
  const me = await fetch(`${BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('\nme status =', me.status);
  console.log(await me.text());
}
