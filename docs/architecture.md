# Architecture

The target repository is organized as a pnpm workspace:

```text
apps/extension  Chrome Manifest V3 client (currently implemented)
apps/web        Next.js SaaS dashboard (planned)
apps/api        Node.js/Express API (planned)
packages/database  PostgreSQL and pgvector (planned)
packages/shared    shared contracts and validation (planned)
packages/ai        OCR, tagging and embeddings (planned)
packages/ui        shared UI components (reserved)
```

The extension currently runs independently with `chrome.storage.local`. The migration path is:

1. Define capture and item contracts in `packages/shared`.
2. Add server authentication and ownership checks in `apps/api`.
3. Persist items and assets in PostgreSQL/object storage.
4. Move OCR, tagging and embeddings into a retryable processing module.
5. Connect both `apps/extension` and `apps/web` to the API.