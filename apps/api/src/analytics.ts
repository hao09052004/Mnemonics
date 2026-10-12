/**
 * Server-side analytics event emitter.
 *
 * Emits a row into `analytics_events` (M5). The helper swallows
 * any error so the calling business flow (capture, search,
 * payment) is never affected by a telemetry failure. Each call
 * is fire-and-forget; we do NOT block the request on the insert.
 *
 * Privacy contract (see migration 031): `metadata` MUST NOT
 * contain raw memory content, raw OCR/PDF text, search query
 * text, AI prompts/responses, or any user content. Pass
 * privacy-safe counters + booleans only.
 */
import type { Pool } from 'pg';

export type AnalyticsEventName =
  | 'user_registered'
  | 'user_logged_in'
  | 'memory_created'
  | 'memory_deleted'
  | 'search_performed'
  | 'semantic_search_performed'
  | 'space_created'
  | 'capture_failed'
  | 'checkout_started'
  | 'payment_confirmed'
  | 'subscription_activated'
  | 'subscription_expired'
  | 'subscription_renewed';

export interface EmitEventArgs {
  userId: string | null;
  eventName: AnalyticsEventName;
  entityType?: string;
  metadata?: Record<string, unknown>;
  source?: 'server' | 'client';
  schemaVersion?: string;
}

export function emitAnalyticsEvent(
  pool: Pool,
  args: EmitEventArgs
): void {
  // Fire and forget. The `void` Promise is intentionally not
  // awaited so the calling request is not delayed.
  void pool
    .query(
      `INSERT INTO analytics_events
         (user_id, event_name, entity_type, metadata, source, schema_version)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        args.userId,
        args.eventName,
        args.entityType ?? null,
        JSON.stringify(args.metadata ?? {}),
        args.source ?? 'server',
        args.schemaVersion ?? '1'
      ]
    )
    .catch((e) => {
      console.warn('[analytics] emit failed', args.eventName, (e as Error).message);
    });
}
