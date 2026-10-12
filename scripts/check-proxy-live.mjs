// Verify proxy is currently running + returns ACAO header
async function test() {
  try {
    const res = await fetch('http://localhost:4000/api/v1/proxy/image?url=' + encodeURIComponent('https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400'));
    console.log('status:', res.status);
    console.log('acao:', res.headers.get('access-control-allow-origin'));
    console.log('content-type:', res.headers.get('content-type'));
  } catch (e) {
    console.log('ERROR: proxy unreachable —', e.message);
  }
}
test();
