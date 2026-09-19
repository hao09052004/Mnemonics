const BASE = 'http://localhost:4000/api/v1/auth';
const email = `reg+${Date.now()}@gmail.com`;
const password = 'StrongPass#2026';
const name = 'Smoke Reg';

const reg = await fetch(`${BASE}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, name })
});
const regText = await reg.text();
console.log('register status =', reg.status);
const regJson = regText ? JSON.parse(regText) : null;
console.log(JSON.stringify(regJson, null, 2));
if (regJson?.data?.session?.accessToken) {
  console.log('\nEMAIL =', email);
  console.log('PASSWORD =', password);
  console.log('USER_ID =', regJson.data.user?.id);
}
