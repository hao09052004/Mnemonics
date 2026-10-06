/**
 * Visual embedding provider interface.
 *
 * Visual embeddings are stored in a SEPARATE pgvector table
 * (`item_visual_embeddings`, 512-d) and never mixed with text
 * embeddings. The two similarity searches are exposed to the UX as
 * "Related by meaning" and "Visually similar" respectively.
 *
 * Implementations are local (CLIP via @huggingface/transformers).
 * No paid visual provider is supported in the current architecture.
 */

export interface VisualInput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface VisualEmbeddingResult {
  /** 512-d L2-normalised float32. */
  vector: number[];
  model: string;
  /** Inference time in ms (best-effort, for telemetry). */
  inferenceMs?: number;
}

export interface VisualProviderInfo {
  name: string;
  model: string;
  dimensions: number;
  /** True if the underlying model is loaded and ready. */
  loaded: boolean;
}

export interface VisualProvider {
  embed(input: VisualInput): Promise<VisualEmbeddingResult>;
  /** Trigger model load. Idempotent. Safe to call multiple times. */
  warmup(): Promise<void>;
  info(): VisualProviderInfo;
}
