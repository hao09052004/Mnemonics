# Production deployment

Mnemonics production deployment configurations.

## Files

- `koyeb.yaml` — Koyeb Blueprint (API service, **recommended**)
- `render.yaml` — Render Blueprint (API service, kept as a backup)
- `railway.toml` — Railway config (legacy; prefer Koyeb)
- `fly.toml` — Fly.io config (legacy; prefer Koyeb)
- `Dockerfile` (repo root) — Multi-purpose container image (used by Koyeb/Fly)
- `.env.production.koyeb.example` — Env-var checklist for the **Koyeb** dashboard
- `.env.production.example` — Env-var checklist for the **Render** dashboard
- `.dockerignore` (repo root) — Trims the Docker build context

## Recommended free-tier stack

| Component | Host | Why |
|-----------|------|-----|
| **API** | Koyeb Web Service (free plan) | Auto-detect `koyeb.yaml`, 512 MB RAM, **1-hour** idle before sleep (vs Render's 15 min), **1-5 s** cold start (vs Render's ~60 s), no need for a separate keep-alive cron |
| **Web dashboard** | Vercel (free) | No sleep, global CDN, instant deploy from `apps/web` |
| **Database** | Supabase (free forever, 500 MB) | Already configured; pgvector enabled. **Do NOT** provision Koyeb Postgres — its free tier is only 5 h of compute/month and sleeps after 5 min |
| **Storage** | Supabase Storage (free, 1 GB) | Image captures |
| **Auth** | Supabase Auth (free, 50k MAU) | Email + password + recovery |
| **AI** | Google AI Studio Free Tier | Gemini text + embedding, 15 RPM, 1500 RPD per model |
| **Extension** | Load unpacked in `chrome://extensions` | No server needed |

## Koyeb vs Render (free tier)

| | Koyeb Free | Render Free |
|---|---|---|
| Sleep after | 1 h idle | 15 min idle |
| Cold start | 1-5 s | ~60 s |
| Health check | HTTP /health, configurable | HTTP /health, configurable |
| Postgres free | 5 h/month, sleeps 5 min | expires 30 days |
| Buildpack | ✅ | ✅ |
| Dockerfile | ✅ | ✅ |
| Monorepo workdir | ✅ | ✅ |
| Custom domain | ✅ | ✅ |
| Concurrent deploys | 1 free instance / org | 1 free service per workspace |
| Secret management | dashboard, `koyeb service update --env` | dashboard, `render env` |
| Cost to upgrade (always-on) | `eco` from $1.61/mo | `starter` $7/mo |

Verdict: **Koyeb** is the better default for hobby projects because the longer idle window means the cron-job keep-alive workaround is rarely needed.

## Quick Start — Koyeb (recommended)

1. **PR**: merge `fix/semantic-search-default-on` → `main` (or your deploy branch)
2. **Koyeb Web Service**:
   1. Go to https://app.koyeb.com → **Create Web Service**
   2. Choose **GitHub**, install the Koyeb GitHub App, select `hao09052004/Mnemonics`
   3. **Branch**: `main`
   4. **Builder**: `Dockerfile`
   5. **Dockerfile location**: `./Dockerfile` (relative to work directory)
   6. **Work directory**: leave empty (build context is the repo root)
   7. **Service name**: `mnemonics-api`
   8. **Region**: `Frankfurt (fra)` (or `Washington, D.C. (was)`)
   9. **Instance type**: `Free`
   10. **Port**: `4000`  → **Routes**: `/: 4000`
   11. **Health check**: HTTP, port 4000, path `/api/v1/health`
   12. Click **Deploy**
3. **Environment**: copy every value from `deploy/.env.production.koyeb.example` into the Koyeb dashboard → Settings → Environment Variables. **Do NOT** commit the real values.
4. **Migrations**: open the Koyeb instance console (or `koyeb service exec mnemonics-api /bin/sh`) and run:
   ```bash
   pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts
   ```
5. **Smoke test**:
   ```bash
   curl https://<service>-<org>.koyeb.app/api/v1/health
   ```
6. **Web**: deploy `apps/web` to Vercel with `VITE_API_URL=https://<service>-<org>.koyeb.app`
7. **CORS**: update `CORS_ALLOWED_ORIGINS` on Koyeb with the Vercel URL → service redeploys
8. **Extension**: load `apps/extension` as unpacked in Chrome, set API URL in extension settings

## Quick Start — Render (backup)

1. **Render Blueprint**: https://dashboard.render.com/blueprints → New Blueprint Instance → repo `hao09052004/Mnemonics` → branch `main` → Apply
2. **Environment**: copy every value from `.env.production.example` into the Render dashboard.
3. **Migrations**: open the Render Shell for `mnemonics-api` and run:
   ```bash
   pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts
   ```
4. **Keep-alive** (only on Render free): ping `https://<service>.onrender.com/api/v1/health` every 14 min from cron-job.org so the service does not sleep after 15 min idle.

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

See `.env.production.koyeb.example` (or `.env.production.example` for Render) for the full list including fallbacks, quotas, and Gemini resilience settings.

## Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_AUTO_CONFIRM` | `false` | Auto-confirm email registrations |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |

## Free-tier gotchas

- **Koyeb free web service sleeps after 1 h of inactivity** — first request takes 1-5 s. Because the idle window is much longer than Render's, you can usually skip a keep-alive cron.
- **Koyeb free Postgres** = 5 h/month compute, 1 GB, sleeps after 5 min. We use Supabase Postgres instead (free forever, 500 MB).
- **Render free web service sleeps after 15 min of inactivity** — first request takes ~30 s. Use a cron-job (e.g. cron-job.org) to ping `/health` every 14 min.
- **Render free Postgres expires after 30 days** — we use Supabase Postgres instead, which is free forever (500 MB).
- **Gemini Free Tier**: 15 RPM, 1500 RPD per model. The shared pacer in `packages/ai` enforces 12 RPM with a 15 s timeout. Per-user cap is `AI_USER_DAILY_LIMIT` (default 100).
- **Supabase Storage free**: 1 GB. Each image capture is stored here; budget ~50 KB average → ~20k images before you hit the cap.
- **Vercel free**: 100 GB bandwidth, no sleep, instant cold start.
