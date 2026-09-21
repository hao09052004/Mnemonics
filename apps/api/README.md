# API

Node.js/Express service for the Mnemonics capture pipeline.

## Run

```powershell
pnpm --filter @mnemonics/api dev
```

The service listens on port `4000` and exposes:

### Health & Monitoring
- `GET /health` - Health check (includes DB connectivity)
- `GET /metrics` - Detailed metrics (counters, histograms)
- `GET /stats` - Simple stats summary

### Authentication
- `POST /api/v1/auth/register` - Email + password signup
- `POST /api/v1/auth/login` - Returns session
- `POST /api/v1/auth/refresh` - Rotate session
- `POST /api/v1/auth/logout` - Revoke session
- `POST /api/v1/auth/forgot-password` - Recovery
- `POST /api/v1/auth/reset-password` - Reset with token
- `POST /api/v1/auth/resend-verification` - Resend email
- `GET /api/v1/auth/me` - Current user info

### Captures
- `POST /api/v1/captures` - Create text/link capture
- `POST /api/v1/captures/image` - Create image capture (multipart)

### Items
- `GET /api/v1/items` - List user's items
- `GET /api/v1/items/:id` - Get single item
- `PATCH /api/v1/items/:id` - Update item
- `DELETE /api/v1/items/:id` - Delete item

### Search
- `GET /api/v1/search?q=...` - Hybrid search (lexical + semantic)
- `POST /api/v1/search` - Same with JSON body

### Tags
- `GET /api/v1/tags` - List user's tags
- `GET /api/v1/tags/:name/items` - Items with this tag
- `POST /api/v1/tags/suggest` - Suggest tags for text

### Knowledge Graph
- `POST /api/v1/items/:id/edges` - Create edge between items
- `GET /api/v1/items/:id/edges` - List edges
- `GET /api/v1/items/:id/related` - Find related items (vector similarity)
- `DELETE /api/v1/edges/:id` - Delete edge
- `GET /api/v1/graph/stats` - Graph statistics

### Jobs (Background Processing)
- `GET /api/v1/jobs/health` - Job queue health
- `GET /api/v1/jobs/:id` - Job status
- `GET /api/v1/items/:itemId/jobs` - Jobs for an item
- `POST /api/v1/items/:itemId/jobs/:type` - Manually trigger job (debug)

## Environment Variables

```bash
DATABASE_URL=postgres://user:pass@host:5432/db  # Required
SUPABASE_URL=https://xxx.supabase.co              # Required
SUPABASE_ANON_KEY=eyJ...                          # Required
SUPABASE_SERVICE_ROLE_KEY=eyJ...                  # Required for image upload
OPENAI_API_KEY=sk-...                             # Required for embeddings/tags
PORT=4000                                         # Optional, default 4000
DEV_AUTH_TOKEN=mnemonics-dev-token                # Optional, dev only
DEV_USER_ID=00000000-...                          # Optional, dev only
AUTH_AUTO_CONFIRM=false                           # Optional, default false
```

## Setup

1. Apply database migrations:
```bash
for f in packages/database/migrations/*.sql; do
  psql $DATABASE_URL -f "$f"
done
```

2. Set environment variables (see `.env.example`)

3. Run the server:
```bash
pnpm dev
```

## Pipeline

The capture flow runs asynchronously:

```
User → POST /api/v1/captures
            ↓
        Create items row (status: pending)
            ↓
        Enqueue jobs: tag → embed
            ↓
        Return 201 with item ID

[Background worker]
        ↓
        Process tag job (OpenAI/heuristic)
            ↓
        Process embed job (OpenAI)
            ↓
        Mark items.status = 'ready'
```

For images:
```
User → POST /api/v1/captures/image
            ↓
        Upload to Supabase Storage
            ↓
        Create items row (status: pending)
            ↓
        Enqueue: ocr → tag → embed
```

See [workflows/product/capture-to-knowledge.md](../../workflows/product/capture-to-knowledge.md) for details.

## Testing

```bash
pnpm test
```

See [docs/deployment.md](../../docs/deployment.md) for production setup.
