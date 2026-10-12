/**
 * Content classification provider (spec 0005 §5).
 *
 * The classifier takes a captured item (canonical content + optional
 * source metadata) and returns a structured `ClassificationResult`
 * with a stable provenance chain.
 *
 * Design rules:
 *  - The provider MUST emit a `classifier_version` that is part of
 *    the JobQueue idempotence key (item_id, classifier_version,
 *    content_hash). Two different versions of the same item may
 *    be classified independently.
 *  - The provider MUST emit a `detected_type` from the closed
 *    vocabulary in `detectedTypeSchema`.
 *  - The provider MUST populate `evidence` (record of which
 *    field came from which source). Priority: `user` >
 *    `structured_data` (JSON-LD) > `html_meta` > `dom` >
 *    `extracted_text` > `ocr` > `gemini_vision` > `gemini_text`.
 *  - The provider MUST be idempotent for a given content hash.
 *  - The provider MUST return a `ready` result; failure is
 *    represented by throwing. A free-tier noop fallback returns
 *    status `skipped` and a `null` detected_type.
 */
import { z } from 'zod';

/** Closed list of semantic kinds (spec 0005 §5.2). */
export const detectedTypeSchema = z.enum([
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
]);

export const classificationStatusSchema = z.enum([
  'pending','processing','ready','failed','skipped'
]);

/** Per-field provenance (spec 0005 §5.5). */
export const evidenceSourceSchema = z.enum([
  'user',
  'structured_data',
  'html_meta',
  'dom',
  'extracted_text',
  'ocr',
  'gemini_vision',
  'gemini_text'
]);

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

/**
 * Output of the classifier. The fields are permissive because
 * different `detected_type`s carry different attributes; the
 * router/HTTP layer normalises via `ClassificationOutput` Zod
 * schema. We still bound `attributes` and `entities` to JSON-
 * safe shapes.
 */
export const classificationResultSchema = z.object({
  detectedType: detectedTypeSchema.nullable(),
  category: z.string().max(80).nullable(),
  description: z.string().max(2000).nullable(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  entities: z.array(z.record(z.string(), z.unknown())).default([]),
  evidence: z.record(z.string(), evidenceSourceSchema).default({}),
  confidence: z.number().min(0).max(1).nullable(),
  classifierVersion: z.string().min(1).max(64),
  status: classificationStatusSchema
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

/**
 * Input the classifier consumes. The repository layer is the
 * source of `title`, `body` and `sourceUrl`; `sourceMetadata`
 * comes from the capture pipeline.
 */
export interface ClassificationInput {
  itemId: string;
  userId: string;
  type: 'link' | 'text' | 'image' | 'screenshot' | 'document';
  title: string;
  body: string;
  sourceUrl: string | null;
  sourceMetadata: Record<string, unknown> | null;
  contentHash: string;
}

export interface ContentClassifierInfo {
  name: string;
  model: string;
  version: string;
  /** True when this classifier is the free-tier noop. */
  isFallback: boolean;
}

export interface ContentClassifier {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  info(): ContentClassifierInfo;
}
