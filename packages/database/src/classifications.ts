/**
 * Item classification repository (M4 of spec 0005).
 *
 * One row per item in `item_classifications`. The classifier
 * worker writes this row after the user captures an item; the
 * dashboard reads it to render the "Detected: <type>" chip.
 *
 * The merge step (where a reclassify must not overwrite a
 * user-edited attribute, see spec 0005 §20.1) lives in the
 * handler at apps/api/src/jobs/handlers/classify.ts; this
 * module is the persistence-only façade over the table.
 */

import type { Pool } from 'pg';

/**
 * Controlled vocabulary for `item_classifications.detected_type`.
 * Mirrors the CHECK constraint in migration 025. A copy lives
 * here (not imported from `@mnemonics/ai`) so the database
 * package stays a leaf-level dependency — `ai` imports shared,
 * not the other way around.
 */
export type DetectedType =
  | 'article' | 'product' | 'recipe' | 'video' | 'quote' | 'highlight'
  | 'webpage' | 'image' | 'note' | 'document' | 'other';

export type ClassificationStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

export interface ItemClassification {
  itemId: string;
  userId: string;
  detectedType: DetectedType | null;
  category: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  entities: unknown[];
  evidence: Record<string, string>;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  classifierVersion: string;
  status: ClassificationStatus;
  errorCode: string | null;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassificationUpsertInput {
  itemId: string;
  userId: string;
  detectedType: DetectedType | null;
  category?: string | null;
  description?: string | null;
  attributes?: Record<string, unknown>;
  entities?: unknown[];
  evidence?: Record<string, string>;
  confidence?: number | null;
  provider: string;
  model: string;
  classifierVersion: string;
  status: ClassificationStatus;
  errorCode?: string | null;
  contentHash: string | null;
}

export interface ClassificationRepository {
  findByItemId(itemId: string, userId: string): Promise<ItemClassification | null>;
  listByUser(userId: string): Promise<ItemClassification[]>;
  upsert(input: ClassificationUpsertInput): Promise<ItemClassification>;
}

interface ClassificationRow {
  item_id: string;
  user_id: string;
  detected_type: string | null;
  category: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  entities: unknown[];
  evidence: Record<string, string>;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  classifier_version: string;
  status: string;
  error_code: string | null;
  content_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToClassification(row: ClassificationRow): ItemClassification {
  return {
    itemId: row.item_id,
    userId: row.user_id,
    detectedType: (row.detected_type as DetectedType | null) ?? null,
    category: row.category,
    description: row.description,
    attributes: row.attributes ?? {},
    entities: row.entities ?? [],
    evidence: row.evidence ?? {},
    confidence: row.confidence,
    provider: row.provider,
    model: row.model,
    classifierVersion: row.classifier_version,
    status: row.status as ClassificationStatus,
    errorCode: row.error_code,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createClassificationRepository(pool: Pool): ClassificationRepository {
  return {
    async findByItemId(itemId, userId) {
      const result = await pool.query<ClassificationRow>(
        `SELECT item_id, user_id, detected_type, category, description,
                attributes, entities, evidence, confidence, provider, model,
                classifier_version, status, error_code, content_hash,
                created_at, updated_at
           FROM item_classifications
          WHERE item_id = $1 AND user_id = $2`,
        [itemId, userId]
      );
      const row = result.rows[0];
      return row ? rowToClassification(row) : null;
    },

    async listByUser(userId) {
      const result = await pool.query<ClassificationRow>(
        `SELECT item_id, user_id, detected_type, category, description,
                attributes, entities, evidence, confidence, provider, model,
                classifier_version, status, error_code, content_hash,
                created_at, updated_at
           FROM item_classifications
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [userId]
      );
      return result.rows.map(rowToClassification);
    },

    async upsert(input) {
      // Ownership guard runs first. The DB trigger
      // `enforce_item_classification_ownership` is a backstop,
      // but checking here gives a clean error message and
      // avoids a confusing "null in user_id" report.
      const item = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM items WHERE id = $1`,
        [input.itemId]
      );
      if (!item.rows[0]) {
        throw new Error('OWNERSHIP_MISMATCH: parent item not found');
      }
      if (item.rows[0].user_id !== input.userId) {
        throw new Error('OWNERSHIP_MISMATCH: item.user_id != row.userId');
      }
      const result = await pool.query<ClassificationRow>(
        `INSERT INTO item_classifications
           (item_id, user_id, detected_type, category, description,
            attributes, entities, evidence, confidence,
            provider, model, classifier_version, status, error_code, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 $10, $11, $12, $13, $14, $15)
         ON CONFLICT (item_id) DO UPDATE SET
           detected_type      = EXCLUDED.detected_type,
           category           = EXCLUDED.category,
           description        = EXCLUDED.description,
           attributes         = EXCLUDED.attributes,
           entities           = EXCLUDED.entities,
           evidence           = EXCLUDED.evidence,
           confidence         = EXCLUDED.confidence,
           provider           = EXCLUDED.provider,
           model              = EXCLUDED.model,
           classifier_version = EXCLUDED.classifier_version,
           status             = EXCLUDED.status,
           error_code         = EXCLUDED.error_code,
           content_hash       = EXCLUDED.content_hash,
           updated_at         = NOW()
         RETURNING item_id, user_id, detected_type, category, description,
                   attributes, entities, evidence, confidence, provider, model,
                   classifier_version, status, error_code, content_hash,
                   created_at, updated_at`,
        [
          input.itemId,
          input.userId,
          input.detectedType,
          input.category ?? null,
          input.description ?? null,
          JSON.stringify(input.attributes ?? {}),
          JSON.stringify(input.entities ?? []),
          JSON.stringify(input.evidence ?? {}),
          input.confidence ?? null,
          input.provider,
          input.model,
          input.classifierVersion,
          input.status,
          input.errorCode ?? null,
          input.contentHash
        ]
      );
      return rowToClassification(result.rows[0]);
    }
  };
}
