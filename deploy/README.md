# Production deployment

Mnemonics production deployment configurations.

## Files

- `render.yaml` — Render Blueprint (API service)
- `railway.toml` — Railway config (legacy; prefer Render)
- `fly.toml` — Fly.io config (legacy; prefer Render)
- `Dockerfile` — Multi-purpose container image (used by Railway/Fly)
- `.env.production.example` — **Full env-var checklist for the Render dashboard**

## Recommended free-tier stack

| Component | Host | Why |
|-----------|------|-----|
| **API** | Render Web Service (free plan) | Auto-detect `render.yaml`, free Postgres alternative, sleep after 15 min (use a cron-job to keep alive) |
| **Web dashboard** | Vercel (free) | No sleep, global CDN, instant deploy from `apps/web` |
| **Database** | Supabase (free forever, 500 MB) | Already configured; pgvector enabled. **Do NOT** provision Render Postgres — its free tier expires after 90 days |
| **Storage** | Supabase Storage (free, 1 GB) | Image captures |
| **Auth** | Supabase Auth (free, 50k MAU) | Email + password + recovery |
| **AI** | Google AI Studio Free Tier | Gemini text + embedding, 15 RPM, 1500 RPD per model |
| **Extension** | Load unpacked in `chrome://extensions` | No server needed |

## Quick Start — Render

1. **PR**: merge `fix/semantic-search-default-on` → `main` (or your deploy branch)
2. **Render Blueprint**: https://dashboard.render.com/blueprints → New Blueprint Instance → repo `hao09052004/Mnemonics` → branch `main` → Apply
3. **Environment**: copy every value from `.env.production.example` into the Render dashboard. **Do NOT** commit the real values.
4. **Migrations**: open the Render Shell for `mnemonics-api` and run:
   ```bash
   pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts
   ```
5. **Smoke test**:
   ```bash
   curl https://<api-service>.onrender.com/health
   ```
6. **Web**: deploy `apps/web` to Vercel with `VITE_API_URL=https://<api-service>.onrender.com`
7. **CORS**: update `CORS_ALLOWED_ORIGINS` on Render with the Vercel URL → auto-redeploy
8. **Extension**: load `apps/extension` as unpacked in Chrome, set API URL in extension settings

## Quick Start — Railway

1. Fork this repo
2. Create new project from GitHub
3. Add PostgreSQL with pgvector extension
4. Set environment variables (use `.env.production.example` as the checklist)
5. Deploy

## Quick Start — Fly.io

1. Install flyctl
2. `fly launch`
3. Provision Postgres with pgvector
4. Set secrets
5. `fly deploy`

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string with pgvector (Supabase session pooler, port 5432) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `GEMINI_API_KEY` | **AI Studio key** (`AIza...`); **NOT** an ADC token (`AQ.Ab8RN...`) |
| `NODE_ENV` | `production` |
| `PORT` | `4000` (or platform-assigned) |

See `.env.production.example` for the full list including fallbacks, quotas, and Gemini resilience settings.

## Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_AUTO_CONFIRM` | `false` | Auto-confirm email registrations |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |

## Free-tier gotchas

- **Render free web service sleeps after 15 min of inactivity** — first request takes ~30 s. Use a cron-job (e.g. cron-job.org) to ping `/health` every 14 min.
- **Render free Postgres expires after 90 days** — we use Supabase Postgres instead, which is free forever (500 MB).
- **Gemini Free Tier**: 15 RPM, 1500 RPD per model. The shared pacer in `packages/ai` enforces 12 RPM with a 15 s timeout. Per-user cap is `AI_USER_DAILY_LIMIT` (default 100).
- **Supabase Storage free**: 1 GB. Each image capture is stored here; budget ~50 KB average → ~20k images before you hit the cap.
- **Vercel free**: 100 GB bandwidth, no sleep, instant cold start.
