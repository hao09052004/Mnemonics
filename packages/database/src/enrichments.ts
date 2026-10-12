/**
 * Memory Understanding — enrichment persistence layer.
 *
 * This is intentionally a thin façade over the `item_enrichments`
 * table. The heavy logic (image captioning, TLDR fusion, etc.)
 * lives in `@mnemonics/ai`; this module is the only place that
 * talks to the SQL.
 */

import { Pool } from 'pg';

export type EnrichmentStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'disabled';

export type TldrSource = 'pending' | 'local_ai' | 'cloud_ai' | 'heuristic' | 'user';

export interface ItemEnrichment {
  itemId: string;
  userId: string;
  caption: string | null;
  captionProvider: string | null;
  captionModel: string | null;
  captionConfidence: number | null;
  captionStatus: EnrichmentStatus;
  captionErrorCode: string | null;
  captionCreatedAt: Date | null;
  captionUpdatedAt: Date | null;
  tldr: string | null;
  tldrSource: TldrSource;
  tldrProvider: string | null;
  tldrModel: string | null;
  tldrPromptVersion: string | null;
  tldrStatus: EnrichmentStatus;
  tldrErrorCode: string | null;
  tldrCreatedAt: Date | null;
  tldrUpdatedAt: Date | null;
  summary: string | null;
  summaryProvider: string | null;
  summaryModel: string | null;
  summaryStatus: EnrichmentStatus;
  promptVersion: string | null;
  processingVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnrichmentRepository {
  ensureRow(itemId: string, userId: string): Promise<void>;
  getForItem(itemId: string): Promise<ItemEnrichment | null>;
  setCaption(
    itemId: string,
    userId: string,
    value: {
      caption: string;
      provider: string;
      model: string;
      confidence?: number | null;
    }
  ): Promise<void>;
  setCaptionFailure(itemId: string, userId: string, errorCode: string): Promise<void>;
  setTldr(
    itemId: string,
    userId: string,
    value: {
      tldr: string;
      source: TldrSource;
      provider: string;
      model: string;
      promptVersion: string;
    }
  ): Promise<void>;
  setUserTldr(itemId: string, userId: string, tldr: string): Promise<void>;
  setFailure(itemId: string, userId: string, errorCode: string): Promise<void>;
  /** Bulk fetch for embedding refresh. */
  listTextForEmbedding(userId: string, itemIds: string[]): Promise<Array<{
    itemId: string;
    title: string;
    ocrText: string | null;
    rawText: string | null;
    caption: string | null;
    tldr: string | null;
  }>>;
}

function toRow(itemId: string, userId: string): Record<string, unknown> {
  return { item_id: itemId, user_id: userId };
}

function fromRow(row: Record<string, unknown>): ItemEnrichment {
  return {
    itemId: String(row.item_id),
    userId: String(row.user_id),
    caption: (row.caption as string | null) ?? null,
    captionProvider: (row.caption_provider as string | null) ?? null,
    captionModel: (row.caption_model as string | null) ?? null,
    captionConfidence: row.caption_confidence == null
      ? null
      : Number(row.caption_confidence),
    captionStatus: row.caption_status as EnrichmentStatus,
    captionErrorCode: (row.caption_error_code as string | null) ?? null,
    captionCreatedAt: row.caption_created_at
      ? new Date(row.caption_created_at as string)
      : null,
    captionUpdatedAt: row.caption_updated_at
      ? new Date(row.caption_updated_at as string)
      : null,
    tldr: (row.tldr as string | null) ?? null,
    tldrSource: row.tldr_source as TldrSource,
    tldrProvider: (row.tldr_provider as string | null) ?? null,
    tldrModel: (row.tldr_model as string | null) ?? null,
    tldrPromptVersion: (row.tldr_prompt_version as string | null) ?? null,
    tldrStatus: row.tldr_status as EnrichmentStatus,
    tldrErrorCode: (row.tldr_error_code as string | null) ?? null,
    tldrCreatedAt: row.tldr_created_at
      ? new Date(row.tldr_created_at as string)
      : null,
    tldrUpdatedAt: row.tldr_updated_at
      ? new Date(row.tldr_updated_at as string)
      : null,
    summary: (row.summary as string | null) ?? null,
    summaryProvider: (row.summary_provider as string | null) ?? null,
    summaryModel: (row.summary_model as string | null) ?? null,
    summaryStatus: row.summary_status as EnrichmentStatus,
    promptVersion: (row.prompt_version as string | null) ?? null,
    processingVersion: (row.processing_version as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string)
  };
}

export function createEnrichmentRepository(pool: Pool): EnrichmentRepository {
  return {
    async ensureRow(itemId, userId) {
      // Idempotent: a single row per item.
      await pool.query(
        `INSERT INTO item_enrichments (item_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (item_id) DO NOTHING`,
        [itemId, userId]
      );
    },

    async getForItem(itemId) {
      const res = await pool.query<Record<string, unknown>>(
        `SELECT * FROM item_enrichments WHERE item_id = $1`,
        [itemId]
      );
      return res.rows[0] ? fromRow(res.rows[0]) : null;
    },

    async setCaption(itemId, userId, value) {
      const row = toRow(itemId, userId);
      await pool.query(
        `INSERT INTO item_enrichments
           (item_id, user_id, caption, caption_provider, caption_model,
            caption_confidence, caption_status,
            caption_created_at, caption_updated_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ready', NOW(), NOW(), NOW())
         ON CONFLICT (item_id) DO UPDATE
           SET caption = EXCLUDED.caption,
               caption_provider = EXCLUDED.caption_provider,
               caption_model = EXCLUDED.caption_model,
               caption_confidence = EXCLUDED.caption_confidence,
               caption_status = 'ready',
               caption_error_code = NULL,
               caption_created_at = COALESCE(item_enrichments.caption_created_at, NOW()),
               caption_updated_at = NOW(),
               updated_at = NOW()
        `,
        [
          row.item_id,
          row.user_id,
          value.caption,
          value.provider,
          value.model,
          value.confidence ?? null
        ]
      );
    },

    async setCaptionFailure(itemId, userId, errorCode) {
      await pool.query(
        `INSERT INTO item_enrichments
           (item_id, user_id, caption_status, caption_error_code, updated_at)
         VALUES ($1, $2, 'failed', $3, NOW())
         ON CONFLICT (item_id) DO UPDATE
           SET caption_status = 'failed',
               caption_error_code = EXCLUDED.caption_error_code,
               updated_at = NOW()`,
        [itemId, userId, errorCode.slice(0, 200)]
      );
    },

    async setTldr(itemId, userId, value) {
      await pool.query(
        `INSERT INTO item_enrichments
           (item_id, user_id, tldr, tldr_source, tldr_provider, tldr_model,
            tldr_prompt_version, tldr_status,
            tldr_created_at, tldr_updated_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready',
                 NOW(), NOW(), NOW())
         ON CONFLICT (item_id) DO UPDATE
           SET tldr = EXCLUDED.tldr,
               tldr_source = EXCLUDED.tldr_source,
               tldr_provider = EXCLUDED.tldr_provider,
               tldr_model = EXCLUDED.tldr_model,
               tldr_prompt_version = EXCLUDED.tldr_prompt_version,
               tldr_status = 'ready',
               tldr_error_code = NULL,
               tldr_created_at = COALESCE(item_enrichments.tldr_created_at, NOW()),
               tldr_updated_at = NOW(),
               updated_at = NOW()`,
        [
          itemId,
          userId,
          value.tldr,
          value.source,
          value.provider,
          value.model,
          value.promptVersion
        ]
      );
    },

    async setUserTldr(itemId, userId, tldr) {
      // A user-edited TLDR is protected from auto-overwrite
      // (see setTldr guard in apps/api/src/jobs/handlers/enrich.ts).
      await pool.query(
        `UPDATE item_enrichments
           SET tldr = $3,
               tldr_source = 'user',
               tldr_status = 'ready',
               tldr_updated_at = NOW(),
               updated_at = NOW()
         WHERE item_id = $1 AND user_id = $2`,
        [itemId, userId, tldr]
      );
    },

    async setFailure(itemId, userId, errorCode) {
      await pool.query(
        `INSERT INTO item_enrichments
           (item_id, user_id, tldr_status, tldr_error_code, updated_at)
         VALUES ($1, $2, 'failed', $3, NOW())
         ON CONFLICT (item_id) DO UPDATE
           SET tldr_status = 'failed',
               tldr_error_code = EXCLUDED.tldr_error_code,
               updated_at = NOW()`,
        [itemId, userId, errorCode.slice(0, 200)]
      );
    },

    async listTextForEmbedding(userId, itemIds) {
      if (itemIds.length === 0) return [];
      const res = await pool.query<Record<string, unknown>>(
        `SELECT i.id AS item_id, i.title, i.ocr_text, i.raw_text,
                e.caption, e.tldr
         FROM items i
         LEFT JOIN item_enrichments e ON e.item_id = i.id
         WHERE i.user_id = $1 AND i.id = ANY($2::uuid[])`,
        [userId, itemIds]
      );
      return res.rows.map((row) => ({
        itemId: String(row.item_id),
        title: String(row.title ?? ''),
        ocrText: (row.ocr_text as string | null) ?? null,
        rawText: (row.raw_text as string | null) ?? null,
        caption: (row.caption as string | null) ?? null,
        tldr: (row.tldr as string | null) ?? null
      }));
    }
  };
}