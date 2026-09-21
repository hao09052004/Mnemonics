# Production

Mnemonics production deployment configurations.

## Files

- `railway.toml` - Railway deployment config
- `render.yaml` - Render deployment config
- `fly.toml` - Fly.io deployment config
- `Dockerfile` - Multi-purpose container image

## Quick Start

### Railway
1. Fork this repo
2. Create new project from GitHub
3. Add PostgreSQL with pgvector extension
4. Set environment variables (see deployment.md)
5. Deploy

### Render
1. Connect GitHub repo
2. Render auto-detects render.yaml
3. Add environment variables
4. Deploy

### Fly.io
1. Install flyctl
2. `fly launch`
3. Provision Postgres with pgvector
4. Set secrets
5. `fly deploy`

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string with pgvector |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings/tags |
| `NODE_ENV` | production |
| `PORT` | 4000 (or platform-assigned) |

## Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_AUTO_CONFIRM` | false | Auto-confirm email registrations |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Rate limit window |
| `RATE_LIMIT_MAX` | 100 | Max requests per window |
