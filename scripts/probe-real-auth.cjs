// End-to-end probe: register → login → text capture → image capture
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://localhost:4000';

// 1x1 transparent PNG
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

async function postJson(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

async function postForm(url, form, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers, body: form });
  const text = await r.text();
  return { status: r.status, body: text };
}

(async () => {
  const email = `probe+${Date.now()}@example.com`;
  const password = 'ProbePwd123!';
  const name = 'Probe User';

  console.log('1) Register', email);
  const reg = await postJson(`${BASE}/api/v1/auth/register`, { email, password, name });
  console.log(`   STATUS ${reg.status} BODY ${reg.body}`);
  if (reg.status !== 201) {
    console.log('Registration failed — stop');
    process.exit(1);
  }
  const session = JSON.parse(reg.body).data.session;
  if (!session || !session.accessToken) {
    console.log('No session returned — stop');
    process.exit(1);
  }

  console.log('2) POST /api/v1/captures (text)');
  const textUuid = crypto.randomUUID();
  const text = await postJson(`${BASE}/api/v1/captures`, {
    type: 'text',
    title: 'probe text',
    selectedText: 'hello world',
    clientRequestId: textUuid
  }, { Authorization: `Bearer ${session.accessToken}` });
  console.log(`   STATUS ${text.status} BODY ${text.body}`);

  console.log('3) POST /api/v1/captures/image (multipart)');
  const pngBytes = Buffer.from(pngBase64, 'base64');
  const pngPath = path.join(__dirname, 'test.png');
  fs.writeFileSync(pngPath, pngBytes);
  const fd = new FormData();
  fd.append('file', new Blob([pngBytes], { type: 'image/png' }), 'probe.png');
  fd.append('title', 'probe image');
  fd.append('sourceUrl', '');
  fd.append('capturedAt', '2026-09-21T00:00:00.000Z');
  fd.append('clientRequestId', crypto.randomUUID());
  const img = await postForm(`${BASE}/api/v1/captures/image`, fd, {
    Authorization: `Bearer ${session.accessToken}`
  });
  console.log(`   STATUS ${img.status} BODY ${img.body}`);
})().catch(e => { console.error(e); process.exit(1); });
