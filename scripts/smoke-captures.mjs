// 1) Register a fresh user (auto-confirm path)
const BASE = 'http://localhost:4000';
const AUTH = `${BASE}/api/v1/auth`;

const stamp = Date.now();
const email = `qa+${stamp}@gmail.com`;
const password = 'StrongPass#2026';

const reg = await fetch(`${AUTH}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, name: 'QA User' })
});
const regJson = await reg.json();
console.log('register status =', reg.status);
console.log('  user =', regJson.data?.user?.email, regJson.data?.user?.id);
const token = regJson.data?.session?.accessToken;
if (!token) throw new Error('no session token');

// 2) POST a text capture
const cap = await fetch(`${BASE}/api/v1/captures`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    type: 'text',
    title: 'Smoke text note',
    sourceUrl: 'https://example.com',
    selectedText: 'Hello mnemonics',
    capturedAt: new Date().toISOString(),
    clientRequestId: crypto.randomUUID()
  })
});
const capJson = await cap.json();
console.log('\ncapture status =', cap.status);
console.log('  item =', capJson.data);

// 3) POST a link capture
const link = await fetch(`${BASE}/api/v1/captures`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    type: 'link',
    title: 'Smoke link',
    sourceUrl: 'https://example.org',
    capturedAt: new Date().toISOString(),
    clientRequestId: crypto.randomUUID()
  })
});
const linkJson = await link.json();
console.log('\nlink status =', link.status);
console.log('  item =', linkJson.data);

// 4) POST image (multipart)
const pngBytes = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
  0x89,0x00,0x00,0x00,0x0d,0x49,0x44,0x41,
  0x54,0x78,0x9c,0x63,0x00,0x01,0x00,0x00,
  0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,
  0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
  0x42,0x60,0x82
]);
const form = new FormData();
form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'pixel.png');
form.append('title', 'Smoke image');
form.append('note', 'note here');
form.append('clientRequestId', crypto.randomUUID());
const img = await fetch(`${BASE}/api/v1/captures/image`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form
});
const imgJson = await img.json();
console.log('\nimage status =', img.status);
console.log('  item =', imgJson.data);

console.log('\nUSER EMAIL =', email);
console.log('USER PASS  =', password);
