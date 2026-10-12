// Verify proxy returns Access-Control-Allow-Origin: * so browser <img src> works
async function test() {
  const url = 'http://localhost:4000/api/v1/proxy/image?url=' + encodeURIComponent('https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400');
  const res = await fetch(url);
  console.log('status:', res.status);
  console.log('content-type:', res.headers.get('content-type'));
  console.log('access-control-allow-origin:', res.headers.get('access-control-allow-origin'));
  console.log('cache-control:', res.headers.get('cache-control'));
}
test();
