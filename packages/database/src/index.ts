import { Pool } from 'pg';
import type { CaptureInput, ItemStatus } from '@mnemonics/shared';

export type NewItem = {
  userId: string;
  capture: CaptureInput;
};

export type NewImageItem = NewItem & {
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
  capturedAt: Date;
};

export interface ItemRepository {
  findById(id: string): Promise<StoredItem | null>;
  findByClientRequestId(userId: string, clientRequestId: string): Promise<StoredItem | null>;
  createPendingItem(input: NewItem): Promise<StoredItem>;
  createPendingImageItem(input: NewImageItem): Promise<StoredItem>;
  updateStatus(id: string, status: ItemStatus): Promise<void>;
  updateOcrText(id: string, ocrText: string, options?: { engine?: string; confidence?: number }): Promise<void>;
  updateTags(id: string, tags: string[]): Promise<void>;
  saveEmbedding(itemId: string, userId: string, embedding: number[], model: string): Promise<void>;
}

export function createItemRepository(pool: Pool): ItemRepository {
  return {
    async findById(id: string): Promise<StoredItem | null> {
      const result = await pool.query<StoredItem>(
        `SELECT id, user_id AS "userId", status, type, title,
                source_url AS "sourceUrl", raw_text AS "rawText",
                ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                ocr_confidence AS "ocrConfidence", captured_at AS "capturedAt"
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
                ocr_confidence AS "ocrConfidence", captured_at AS "capturedAt"
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
                   ocr_confidence AS "ocrConfidence", captured_at AS "capturedAt"`,
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
      if (capture.type !== 'image') throw new Error('Image repository requires an image capture');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const itemResult = await client.query<StoredItem>(
          `INSERT INTO items
            (id, user_id, type, title, source_url, raw_text, captured_at, status, client_request_id)
           VALUES ($1, $2, 'image', $3, $4, $5, $6, 'pending', $7)
           RETURNING id, user_id AS "userId", status, type, title,
                     source_url AS "sourceUrl", raw_text AS "rawText",
                     ocr_text AS "ocrText", ocr_engine AS "ocrEngine",
                     ocr_confidence AS "ocrConfidence", captured_at AS "capturedAt"`,
          [itemId, userId, capture.title, capture.sourceUrl ?? null, capture.selectedText ?? null, capture.capturedAt ?? new Date(), capture.clientRequestId]
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

    async updateStatus(id: string, status: ItemStatus): Promise<void> {
      await pool.query(
        `UPDATE items SET status = $2, updated_at = NOW() WHERE id = $1`,
        [id, status]
      );
    },

    async updateOcrText(id: string, ocrText: string, options?: { engine?: string; confidence?: number }): Promise<void> {
      await pool.query(
        `UPDATE items
         SET ocr_text = $2, ocr_engine = $3, ocr_confidence = $4, updated_at = NOW()
         WHERE id = $1`,
        [id, ocrText, options?.engine ?? null, options?.confidence ?? null]
      );
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

    async saveEmbedding(itemId: string, userId: string, embedding: number[], model: string): Promise<void> {
      await pool.query(
        `INSERT INTO item_embeddings (item_id, user_id, model, dimensions, embedding, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (item_id) DO UPDATE SET
           model = EXCLUDED.model,
           dimensions = EXCLUDED.dimensions,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [itemId, userId, model, embedding.length, embedding]
      );
    }
  };
}

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}