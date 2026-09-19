const svc = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0bW93d3RtanRtY2VpaHp2cmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTY5OTU1NSwiZXhwIjoyMTA1Mjc1NTU1fQ.qR4sYBGCorwywXdfXgxMUSjpAIs4ELnirhgwpB63FPQ';
const url = 'https://jtmowwtmjtmceihzvreu.supabase.co/rest/v1/items?select=id,user_id,type,title,status&order=created_at.desc&limit=5';
const r = await fetch(url, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
const data = await r.json();
console.log(JSON.stringify(data, null, 2));
