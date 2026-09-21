# Deployment Guide

This guide covers deploying Mnemonics to production.

## Architecture Overview

```
┌──────────────┐
│  Browser     │ ← Extension (Chrome MV3)
│  Extension   │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────┐
│  Web         │ ← React/Vite dashboard
│  Dashboard   │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────┐     ┌──────────────┐
│  API Server  │ ──▶ │  PostgreSQL  │
│  (Node.js)   │     │  + pgvector  │
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐
│  Supabase    │ ← Auth + Storage
└──────────────┘
```

## Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/db

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenAI (for embeddings/tags/OCR)
OPENAI_API_KEY=sk-...

# Server
PORT=4000
NODE_ENV=production

# Auth
AUTH_AUTO_CONFIRM=false
DEV_AUTH_TOKEN=  # Leave empty in production
DEV_USER_ID=     # Leave empty in production
```

## Database Setup

1. Enable required extensions:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
```

2. Run migrations in order:
```bash
psql $DATABASE_URL -f packages/database/migrations/001_create_items.sql
psql $DATABASE_URL -f packages/database/migrations/002_create_profiles.sql
psql $DATABASE_URL -f packages/database/migrations/003_auth_hardening.sql
psql $DATABASE_URL -f packages/database/migrations/004_job_queue.sql
psql $DATABASE_URL -f packages/database/migrations/005_pgvector_search.sql
psql $DATABASE_URL -f packages/database/migrations/006_knowledge_graph.sql
```

## Building

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm --recursive build

# Build API
pnpm --filter @mnemonics/api build

# Build Web Dashboard
pnpm --filter @mnemonics/web build
```

## Running

### Development
```bash
pnpm dev  # Runs API and web concurrently
```

### Production

#### API Server
```bash
pnpm --filter @mnemonics/api start
```

#### Web Dashboard
```bash
pnpm --filter @mnemonics/web preview
# Or serve dist/ with nginx/CDN
```

## Deployment Platforms

### Recommended: Railway / Render / Fly.io

These platforms support:
- Automatic builds from git
- PostgreSQL with pgvector
- Environment variables
- Auto-scaling

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --recursive build
EXPOSE 4000
CMD ["pnpm", "--filter", "@mnemonics/api", "start"]
```

## Monitoring

The API exposes:
- `GET /health` - Health check with DB connectivity
- `GET /metrics` - Prometheus-style metrics
- `GET /stats` - Simple stats

## Security Checklist

- [ ] `AUTH_AUTO_CONFIRM=false`
- [ ] `DEV_AUTH_TOKEN` and `DEV_USER_ID` unset
- [ ] Database uses SSL connection
- [ ] Supabase service role key is server-side only
- [ ] HTTPS enforced
- [ ] CORS configured for production domains
- [ ] Rate limiting enabled (default)
- [ ] RLS enabled on all tables

## Scaling

- API: Stateless, scale horizontally
- Database: Use connection pooling (PgBouncer)
- Embeddings: Consider batch processing for large items
- Storage: Supabase Storage scales automatically

## Backup Strategy

- Database: Daily automated snapshots
- Supabase Storage: Versioning enabled
- Config: Version controlled in git
