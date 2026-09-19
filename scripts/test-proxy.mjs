async function test() {
  const cases = [
    { label: 'Unsplash', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400' },
    { label: 'Pinterest pinimg.com', url: 'https://i.pinimg.com/564x/4d/83/c2/4d83c2af3a8f8d2d68f4f8d2e1f4f8d2.jpg' },
    { label: 'Imgur', url: 'https://i.imgur.com/y8VtGJH.jpg' },
    { label: 'Random image on fbcdn.net', url: 'https://scontent.fbcdn.net/v/t1.6435-9/1234567890.jpg' },
    { label: 'example.com (blocked host)', url: 'https://example.com/foo.jpg' },
    { label: 'Bad URL', url: 'not-a-url' },
    { label: 'Missing url', url: '' }
  ];
  for (const c of cases) {
    const proxyUrl = 'http://localhost:4000/api/v1/proxy/image?url=' + encodeURIComponent(c.url);
    try {
      const res = await fetch(proxyUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      const isJson = ct.includes('json');
      let detail = '';
      if (isJson) {
        try { detail = ' ' + JSON.parse(buf.toString()).error.code; } catch {}
      }
      console.log(`[${c.label}] HTTP ${res.status} | ${buf.length} bytes${detail}`);
    } catch (err) {
      console.log(`[${c.label}] ERROR ${err.message}`);
    }
  }
}
test();
