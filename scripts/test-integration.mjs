// Simulate the extension background script flow:
// 1. Try proxy → blob
// 2. POST /api/v1/captures/image with multipart file
async function simulate() {
  const API = 'http://localhost:4000';
  const imageUrl = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400';

  // Step 1: proxy
  const proxyRes = await fetch(`${API}/api/v1/proxy/image?url=${encodeURIComponent(imageUrl)}`);
  if (!proxyRes.ok) {
    console.error('proxy fail:', proxyRes.status);
    return;
  }
  const blob = await proxyRes.blob();
  console.log('proxy ok, blob size:', blob.size, 'type:', blob.type);

  // Step 2: upload via multipart
  const form = new FormData();
  form.append('file', blob, 'mnemonics-test.jpg');
  form.append('title', 'Test from proxy');
  form.append('sourceUrl', imageUrl);
  form.append('capturedAt', new Date().toISOString());
  form.append('clientRequestId', crypto.randomUUID());

  const upRes = await fetch(`${API}/api/v1/captures/image`, {
    method: 'POST',
    headers: { Authorization: 'Bearer mnemonics-dev-token' },
    body: form
  });
  const body = await upRes.json();
  console.log('upload:', upRes.status, JSON.stringify(body));
}
simulate();
