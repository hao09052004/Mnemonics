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
import { createJobRouter } from './jobs/router.js';
import { createCaptureRouter } from './routes/capture.js';
import { createSearchRouter } from './routes/search.js';
import { createItemRouter } from './routes/items.js';
import { createTagRouter } from './routes/tags.js';
import { createMonitoringRouter } from './monitoring/monitoring-router.js';
import { metricsMiddleware } from './monitoring/metrics.js';
import { captureLimiter, searchLimiter } from './middleware/rate-limit.js';
import { createGraphRouter } from './routes/graph.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, '../../../.env') });

const port = Number(process.env.PORT || 4000);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const demoMode = process.env.DEMO_MODE === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if ((!supabaseUrl || !supabaseAnonKey) && !demoMode) {
  throw new Error('SUPABASE_URL và SUPABASE_ANON_KEY là bắt buộc (hoặc bật DEMO_MODE=true)');
}

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : undefined;

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
const authDeps = supabase
	? {
			users: createSupabaseUsers(supabase, serviceSupabase),
			throttle: createThrottle(pool),
			audit: createAudit(pool)
		}
	: undefined;

const repository = createItemRepository(pool);
const app = createApp(
	repository,
	process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
	process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001',
	imageStorage,
	supabase,
	authDeps,
	{ autoConfirmRegistration: process.env.AUTH_AUTO_CONFIRM === 'true' }
);

// Set up job queue
const { queue, router: jobRouter } = createJobRouter({
	pool,
	repository,
	supabase: serviceSupabase,
	authSupabase: supabase,
	expectedToken: process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
	developmentUserId: process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001',
	openAiKey: process.env.OPENAI_API_KEY
});

// Create job function for capture routes
const createJob = async (type: 'ocr' | 'tag' | 'embed', itemId: string, userId: string) => {
	return queue.create({ type, itemId, userId });
};

// Mount capture routes with job queue integration
const captureRouter = createCaptureRouter({
	repository,
	imageStorage,
	createJob,
	supabase,
	expectedToken: process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
	developmentUserId: process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001'
});

// Mount search router
const searchRouter = createSearchRouter({
	pool,
	supabase,
	openAiKey: process.env.OPENAI_API_KEY
});

// Mount items router
const itemRouter = createItemRouter({
	pool,
	repository,
	supabase,
	expectedToken: process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
	developmentUserId: process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001'
});

// Mount tags router
const tagRouter = createTagRouter({
	pool,
	supabase
});

// Mount monitoring router (no auth required)
const monitoringRouter = createMonitoringRouter({ pool });

// Mount graph router
const graphRouter = createGraphRouter({
  pool,
  supabase,
  expectedToken: process.env.DEV_AUTH_TOKEN || 'mnemonics-dev-token',
  developmentUserId: process.env.DEV_USER_ID || '00000000-0000-4000-8000-000000000001'
});

// Mount routes
app.use(metricsMiddleware());
app.use('/api/v1', jobRouter);
app.use('/api/v1', captureRouter);
app.use('/api/v1', searchLimiter, searchRouter);
app.use('/api/v1', captureLimiter, itemRouter);
app.use('/api/v1', tagRouter);
app.use('/api/v1', graphRouter);
app.use('/', monitoringRouter);

// Start queue processor
queue.start();

app.listen(port, () => console.log(`Mnemonics API listening on port ${port}`));