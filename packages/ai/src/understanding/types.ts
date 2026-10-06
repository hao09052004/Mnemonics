/**
 * Memory Understanding — provider interface.
 *
 * `describeImage` produces a visual description. `summarize` produces
 * a TLDR. Both are normalised into a single `Understanding` shape so
 * the rest of the codebase never branches on provider.
 *
 * This file is the contract; concrete providers live in
 * `providers/understanding/`.
 */

export interface ImageDescriptionInput {
  bytes: Uint8Array;
  mimeType: string;
  /** Optional language hint (BCP-47). */
  language?: string;
}

export interface ImageDescriptionResult {
  caption: string;
  confidence: number | null;
  model: string;
  provider: string;
  /** Provider-issued revision id. Used to short-circuit duplicate work. */
  revision?: string;
}

export interface TldrInput {
  title: string;
  /** Caption from the image-description provider (may be empty). */
  caption?: string | null;
  /** OCR text (may be empty). */
  ocrText?: string | null;
  /** The captured raw_text/selection (may be empty). */
  rawText?: string | null;
  /** Source URL — useful for "page" captures. */
  sourceUrl?: string | null;
  type: 'link' | 'text' | 'image' | 'screenshot' | 'note';
  /** Locale for the TLDR — defaults to vi-VN. */
  locale?: string;
}

export interface TldrResult {
  tldr: string;
  provider: string;
  model: string;
  promptVersion: string;
  /** The provenance label this provider emits. The API layer maps
   *  this to `item_enrichments.tldr_source`. */
  source: 'local_ai' | 'cloud_ai' | 'heuristic';
  confidence: number | null;
}

export interface ImageDescriptionProvider {
  describe(input: ImageDescriptionInput): Promise<ImageDescriptionResult>;
  info(): { name: string; model: string; loaded: boolean };
}

export interface TldrProvider {
  summarize(input: TldrInput): Promise<TldrResult>;
  info(): { name: string; model: string; promptVersion: string };
}

/** Common error mapping — the worker code should map ProviderError
 *  into a recoverable status rather than crash the pipeline. */
export type { ProviderError as UnderstandingError } from '../types.js';