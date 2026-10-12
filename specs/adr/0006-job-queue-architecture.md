# ADR 0006 — Job Queue Architecture

> Status: Accepted (2026-09-20).
> Deciders: orchestrator, planner.

## Context

The capture-to-knowledge pipeline requires asynchronous processing for:
1. OCR (image analysis)
2. Auto-tagging (LLM or heuristic)
3. Embedding generation (OpenAI)

These operations cannot be synchronous within the capture request because:
- They take 1-30 seconds per item
- They can fail and need retry
- They depend on external services
- The API should respond quickly

## Decision

We implement a **PostgreSQL-backed job queue** with the following design:

### Schema
- `jobs` table with status (`pending`, `processing`, `completed`, `failed`)
- `attempts` counter for retry logic
- `max_attempts` cap (default 3)
- `payload` JSONB for job-specific data

### Processing
- In-process worker polls every 1 second
- Uses `FOR UPDATE SKIP LOCKED` for safe concurrent processing
- EventEmitter pattern for handler registration

### Handlers
- `OcrHandler` - OpenAI Vision API
- `TagHandler` - OpenAI GPT or heuristic fallback
- `EmbedHandler` - OpenAI text-embedding-3-small

### Alternatives Considered
- **BullMQ (Redis)**: More complex, requires Redis. Rejected as YAGNI for MVP.
- **AWS SQS / Cloud Tasks**: External dependency, cost. Deferred.
- **In-memory only**: Lost on restart. Rejected.

## Consequences

- Simple to deploy (no extra services)
- Self-healing via FOR UPDATE SKIP LOCKED
- Database becomes both source of truth and queue
- Single bottleneck at the database

## See also

- [Migration 004](../../packages/database/migrations/004_job_queue.sql)
- [Job Queue Implementation](../../apps/api/src/jobs/queue.ts)
