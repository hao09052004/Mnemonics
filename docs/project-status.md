# Project Status

Audit date: 2026-09-18

## Current level

The repository now has a working capture API foundation in addition to the functional local Chrome extension prototype. It is still not the complete P0 SaaS implementation described in the root README.

## Implemented

- Manifest V3 extension shell and popup.
- Capture of page metadata, links, selections and images through local storage.
- Context menus and desktop notifications.
- Screenshot capture, crop, zoom and save flow.
- Local dashboard with cards, filters, spaces, reminders and local demo authentication.
- Basic local keyword filtering and heuristic tag generation.
- Shared TypeScript/Zod capture contract for `link`, `text` and `image`.
- `POST /api/v1/captures` with development bearer authentication, validation, request IDs and idempotency behavior.
- PostgreSQL `items` migration and parameterized item repository.
- Focused shared/API tests covering auth, validation, pending captures, duplicate requests and image data URL rejection.
- Direct image upload from the extension cropper to API -> Supabase Storage + PostgreSQL `assets`; final images no longer use `chrome.storage.local`.

## Missing for P0

- Production Node.js/Express authentication and user accounts. The current API uses a development bearer-token boundary.
- Server-side authentication, access tokens and refresh flow.
- PostgreSQL deployment and database execution. The initial items migration/repository now exists, but pgvector is not implemented.
- OCR provider integration, embedding generation and processing worker.
- Background processing states: `pending`, `processing`, `ready`, `failed`.
- OCR provider integration, embedding generation and semantic search.
- API-backed Next.js web dashboard.
- User-isolated server queries and integration/E2E tests.
- Production validation, rate limiting, CORS policy and secret management.

## Recommended next milestone

Add production authentication/token exchange and connect the remaining link/text capture actions to the API. After that, add the processing worker for OCR, tags and embeddings.

## Important boundary

The existing local login stores passwords in extension storage and is suitable only for a demo. It must not be reused as production authentication.