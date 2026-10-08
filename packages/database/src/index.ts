import { Pool } from 'pg';
import type { CaptureInput, ItemStatus } from '@mnemonics/shared';

export type NewItem = {
  userId: string;
  capture: CaptureInput;
};

export type NewImageItem = NewItem & {
    itemId: string;
};

/** Pending item shape produced by the document upload route. */
export type NewDocumentItem = NewItem & {
  itemId: string;
};

export type StoredItem = {
  id: string;
  userId: string;
  status: ItemStatus;
  type: string;
  title: string;
  sourceUrl?: string | null;
  rawText?: string | null;
  ocrText?: string | null;
  ocrEngine?: string | null;
  ocrConfidence?: number | null;
  ocrLanguage?: string | null;
  ocrProcessedAt?: Date | null;
  ocrErrorCode?: string | null;
  capturedAt: Date;
};

export type OcrQuotaRow = {
  userId: string;
  quotaDate: string; // YYYY-MM-DD
  callsUsed: number;
};

export interface ItemRepository {
  findById(id: string): Promise<StoredItem | null>;
  findByClientRequestId(userId: string, clientRequestId: string): Promise<StoredItem | null>;
  createPendingItem(input: NewItem): Promise<StoredItem>;
  createPendingImageItem(input: NewImageItem): Promise<StoredItem>;
  /** Persist a `document` item + asset row in one transaction. */
  createPendingDocumentItem(input: NewDocumentItem): Promise<StoredItem>;
  updateStatus(id: string, status: ItemStatus): Promise<void>;
  updateOcrText(
    id: string,
    ocrText: string,
    options?: {
      engine?: string;
      confidence?: number;
      language?: string;
      errorCode?: string;
    }
  ): Promise<void>;
  updateTags(id: string, tags: string[]): Promise<void>;
  /** Read the names of all tags attached to an item. Empty array if none. */
  getTagsForItem(id: string): Promise<string[]>;
  saveEmbedding(itemId: string, userId: string, embedding: number[], model: string): Promise<void>;
  /** Read today's OCR quota row for a user. Returns null if no row exists. */
  getOcrQuotaForDate(userId: string, isoDate: string): Promise<OcrQuotaRow | null>;
  /** Atomically increment today's counter and return the new value. */
  bumpOcrQuotaForDate(userId: string, isoDate: string): Promise<number>;
}

export function createItemRepository(pool: Pool): ItemRepository {
  return {
    async findById(id: string): Promise<StoredItem | null> {
      const result = await pool.query<StoredItem>(
        `SELECT id, user_id AS "userId", status, type, title,
                source_url AS "sourceUrl", raw_text AS "rawText",
                ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                ocr_confidence AS "ocrConfidence",
                ocr_language AS "ocrLanguage",
                ocr_processed_at AS "ocrProcessedAt",
                ocr_error_code AS "ocrErrorCode",
                captured_at AS "capturedAt"
         FROM items WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },

    async findByClientRequestId(userId, clientRequestId) {
      const result = await pool.query<StoredItem>(
        `SELECT id, user_id AS "userId", status, type, title,
                source_url AS "sourceUrl", raw_text AS "rawText",
                ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                ocr_confidence AS "ocrConfidence",
                ocr_language AS "ocrLanguage",
                ocr_processed_at AS "ocrProcessedAt",
                ocr_error_code AS "ocrErrorCode",
                captured_at AS "capturedAt"
         FROM items
         WHERE user_id = $1 AND client_request_id = $2`,
        [userId, clientRequestId]
      );
      return result.rows[0] ?? null;
    },

    async createPendingItem({ userId, capture }) {
      const result = await pool.query<StoredItem>(
        `INSERT INTO items
          (user_id, type, title, source_url, raw_text, captured_at, status, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING id, user_id AS "userId", status, type, title,
                   source_url AS "sourceUrl", raw_text AS "rawText",
                   ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                   ocr_confidence AS "ocrConfidence",
                   ocr_language AS "ocrLanguage",
                   ocr_processed_at AS "ocrProcessedAt",
                   ocr_error_code AS "ocrErrorCode",
                   captured_at AS "capturedAt"`,
        [
          userId,
          capture.type,
          capture.title,
          capture.sourceUrl ?? null,
          capture.type === 'image' ? capture.selectedText ?? null : capture.selectedText ?? null,
          capture.capturedAt ?? new Date(),
          capture.clientRequestId
        ]
      );
      return result.rows[0];
    },

    async createPendingImageItem({ userId, capture, itemId }) {
      if (capture.type !== 'image' && capture.type !== 'screenshot') {
        throw new Error('Image repository requires an image or screenshot capture');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const itemResult = await client.query<StoredItem>(
          `INSERT INTO items
            (id, user_id, type, title, source_url, raw_text, captured_at, status, client_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
           RETURNING id, user_id AS "userId", status, type, title,
                     source_url AS "sourceUrl", raw_text AS "rawText",
                     ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                     ocr_confidence AS "ocrConfidence",
                     ocr_language AS "ocrLanguage",
                     ocr_processed_at AS "ocrProcessedAt",
                     ocr_error_code AS "ocrErrorCode",
                     captured_at AS "capturedAt"`,
          [itemId, userId, capture.type, capture.title, capture.sourceUrl ?? null, capture.selectedText ?? null, capture.capturedAt ?? new Date(), capture.clientRequestId]
        );
        await client.query(
          `INSERT INTO assets (item_id, storage_key, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4)`,
          [itemId, capture.image.storageKey, capture.image.mimeType, capture.image.sizeBytes]
        );
        await client.query('COMMIT');
        return itemResult.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async createPendingDocumentItem({ userId, capture, itemId }) {
      if (capture.type !== 'document') {
        throw new Error('Document repository requires a document capture');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // `raw_text` is set to NULL on insert: the extraction job writes
        // it after parsing. We do NOT store the file bytes anywhere on
        // the row — those live in the object storage bucket under the
        // canonical `<user>/<item>/<filename>` key.
        const itemResult = await client.query<StoredItem>(
          `INSERT INTO items
            (id, user_id, type, title, source_url, raw_text, captured_at, status, client_request_id)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, 'pending', $7)
           RETURNING id, user_id AS "userId", status, type, title,
                     source_url AS "sourceUrl", raw_text AS "rawText",
                     ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                     ocr_confidence AS "ocrConfidence",
                     ocr_language AS "ocrLanguage",
                     ocr_processed_at AS "ocrProcessedAt",
                     ocr_error_code AS "ocrErrorCode",
                     captured_at AS "capturedAt"`,
          [
            itemId,
            userId,
            capture.type,
            capture.title,
            capture.sourceUrl ?? null,
            capture.capturedAt ?? new Date(),
            capture.clientRequestId
          ]
        );
        await client.query(
          `INSERT INTO assets (item_id, storage_key, mime_type, size_bytes, original_filename)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            itemId,
            capture.document.storageKey,
            capture.document.mimeType,
            capture.document.sizeBytes,
            capture.document.originalFilename ?? null
          ]
        );
        await client.query('COMMIT');
        return itemResult.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateStatus(id: string, status: ItemStatus): Promise<void> {
      await pool.query(
        `UPDATE items SET status = $2, updated_at = NOW() WHERE id = $1`,
        [id, status]
      );
    },

    async updateOcrText(
      id: string,
      ocrText: string,
      options?: {
        engine?: string;
        confidence?: number;
        language?: string;
        errorCode?: string;
      }
    ): Promise<void> {
      await pool.query(
        `UPDATE items
         SET ocr_text = $2,
             ocr_engine = $3,
             ocr_confidence = $4,
             ocr_language = $5,
             ocr_error_code = $6,
             ocr_processed_at = COALESCE(ocr_processed_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          ocrText,
          options?.engine ?? null,
          options?.confidence ?? null,
          options?.language ?? null,
          options?.errorCode ?? null,
        ]
      );
    },

    async getOcrQuotaForDate(userId: string, isoDate: string): Promise<OcrQuotaRow | null> {
      const result = await pool.query<{
        user_id: string;
        quota_date: Date;
        calls_used: number;
      }>(
        `SELECT user_id, quota_date, calls_used
         FROM ocr_quota
         WHERE user_id = $1::uuid AND quota_date = $2::date`,
        [userId, isoDate]
      );
      const row = result.rows[0];
      if (!row) return null;
      const d = row.quota_date instanceof Date ? row.quota_date : new Date(row.quota_date);
      const ymd = d.toISOString().slice(0, 10);
      return { userId: row.user_id, quotaDate: ymd, callsUsed: row.calls_used };
    },

    async bumpOcrQuotaForDate(userId: string, isoDate: string): Promise<number> {
      // INSERT … ON CONFLICT DO UPDATE … RETURNING gives us the
      // post-increment value in a single round-trip, which is what
      // every quota tracker needs.
      const result = await pool.query<{ calls_used: number }>(
        `INSERT INTO ocr_quota (user_id, quota_date, calls_used, updated_at)
         VALUES ($1::uuid, $2::date, 1, NOW())
         ON CONFLICT (user_id, quota_date)
         DO UPDATE SET calls_used = ocr_quota.calls_used + 1, updated_at = NOW()
         RETURNING calls_used`,
        [userId, isoDate]
      );
      return result.rows[0]?.calls_used ?? 0;
    },

    async updateTags(id: string, tags: string[]): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get user_id for this item
        const itemResult = await client.query<{ user_id: string }>(
          `SELECT user_id FROM items WHERE id = $1`,
          [id]
        );
        if (!itemResult.rows[0]) {
          throw new Error('Item not found');
        }
        const userId = itemResult.rows[0].user_id;

        // Delete existing tags
        await client.query(
          `DELETE FROM item_tags WHERE item_id = $1`,
          [id]
        );

        // Insert new tags
        for (const tag of tags) {
          const normalizedTag = tag.toLowerCase().replace(/\s+/g, '-');

          // Upsert tag
          await client.query(
            `INSERT INTO tags (id, user_id, name, normalized_name)
             VALUES (gen_random_uuid(), $1::uuid, $2, $2)
             ON CONFLICT (user_id, normalized_name) DO NOTHING`,
            [userId, normalizedTag]
          );

          // Get tag id
          const tagResult = await client.query<{ id: string }>(
            `SELECT id FROM tags WHERE user_id = $1::uuid AND normalized_name = $2`,
            [userId, normalizedTag]
          );

          if (tagResult.rows[0]) {
            // Link tag to item
            await client.query(
              `INSERT INTO item_tags (item_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [id, tagResult.rows[0].id]
            );
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getTagsForItem(id: string): Promise<string[]> {
      const result = await pool.query<{ name: string }>(
        `SELECT t.name
         FROM tags t
         JOIN item_tags it ON it.tag_id = t.id
         WHERE it.item_id = $1
         ORDER BY t.name`,
        [id]
      );
      return result.rows.map((row) => row.name);
    },

    async saveEmbedding(itemId: string, userId: string, embedding: number[], model: string): Promise<void> {
      const vectorLiteral = '[' + embedding.join(',') + ']';

      await pool.query(
        `INSERT INTO item_embeddings (item_id, model, dimensions, embedding, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (item_id) DO UPDATE SET
           model = EXCLUDED.model,
           dimensions = EXCLUDED.dimensions,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [itemId, model, embedding.length, vectorLiteral]
      );
    }
  };
}

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}

export {
  createSpaceRepository,
  type SpaceRepository,
  type Space,
  type SpaceSummary,
  type SpaceType,
  type SpaceColor,
  SPACE_COLORS,
  isSpaceColor,
  type SpaceItem,
  type SpacePreviewItem,
  type CreateSpaceInput,
  type UpdateSpaceInput
} from './spaces.js';

export {
  runSearch,
  resolveSmartSpaceIds,
  hasMeaningfulCriteria,
  normalizeTag,
  SEARCH_KINDS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type SearchRequest,
  type SearchFilters,
  type SearchKind,
  type SearchHit,
  type SearchResponse,
  type SearchDeps,
  type EmbeddingLike
} from './search-service.js';

export {
  createEnrichmentRepository,
  type EnrichmentRepository,
  type EnrichmentStatus,
  type ItemEnrichment,
  type TldrSource
} from './enrichments.js';

export {
  createClusterRepository,
  clusterIdForMembers,
  pickRepresentative,
  collectSignals,
  buildClusterTitle,
  DEFAULT_CLUSTER_CONFIG,
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_SIMILARITY_THRESHOLD,
  CLUSTER_DETAIL_PAGE_SIZE,
  type ClusterConfig,
  type ClusterMember,
  type ClusterCandidate,
  type ClusterRefreshDeps,
  type ClusterRepository,
  type ClusterRefreshResult,
  type ContentCluster,
  type ContentClusterItem,
  type ContentClusterSummary,
  type ClusterPreviewItem
} from './clusters.js';