process.env.DEMO_MODE = 'true';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.DATABASE_URL ||= 'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';
process.env.DEV_AUTH_TOKEN ||= 'mnemonics-dev-token';
process.env.DEV_USER_ID ||= '00000000-0000-4000-8000-000000000001';
process.env.PORT ||= '4000';

await import('../src/server.js');
