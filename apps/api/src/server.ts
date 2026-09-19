import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createItemRepository, createPool } from '@mnemonics/database';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { createSupabaseImageStorage } from './storage.js';
import { createAudit } from './auth/audit.js';
import { createThrottle } from './auth/throttle.js';
import { createSupabaseUsers } from './auth/supabase-users.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, '../../../.env') });

const port = Number(process.env.PORT || 4000);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) throw new Error('SUPABASE_URL và SUPABASE_ANON_KEY là bắt buộc');
const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const pool = createPool(databaseUrl);
let imageStorage;
let serviceSupabase: ReturnType<typeof createClient> | undefined;
if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error('SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY phải được cấu hình cùng nhau');
	}
	imageStorage = createSupabaseImageStorage(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
	serviceSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
const authDeps = {
	users: createSupabaseUsers(supabase, serviceSupabase),
	throttle: createThrottle(pool),
	audit: createAudit(pool)
};
const app = createApp(
	createItemRepository(pool),
	process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
	process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001',
	imageStorage,
	supabase,
	authDeps
);
app.listen(port, () => console.log(`Mnemonics API listening on port ${port}`));