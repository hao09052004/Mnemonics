const url = 'https://jtmowwtmjtmceihzvreu.supabase.co/auth/v1/signup';
const anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0bW93d3RtanRtY2VpaHp2cmV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2OTk1NTUsImV4cCI6MjEwNTI3NTU1NX0.o_K8YiRud5LcPmV4oEJ8rsz4HV-VWFnMKmFbSHMyTUo';
const email = `repro+${Date.now()}@gmail.com`;

const r = await fetch(url, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'StrongPass#2026', data: { name: 'Repro' } })
});
const text = await r.text();
console.log('status =', r.status);
console.log(text);
console.log('EMAIL =', email);
