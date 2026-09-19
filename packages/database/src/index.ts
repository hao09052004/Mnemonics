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
};

export interface ItemRepository {
  findByClientRequestId(userId: string, clientRequestId: string): Promise<StoredItem | null>;
  createPendingItem(input: NewItem): Promise<StoredItem>;
  createPendingImageItem(input: NewImageItem): Promise<StoredItem>;
}

export function createItemRepository(pool: Pool): ItemRepository {
  return {
    async findByClientRequestId(userId, clientRequestId) {
      const result = await pool.query<StoredItem>(
        `SELECT id, user_id AS "userId", status
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
         RETURNING id, user_id AS "userId", status`,
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
           RETURNING id, user_id AS "userId", status`,
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
    }
  };
}

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}