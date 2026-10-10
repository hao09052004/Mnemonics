/**
 * OCR provider interface.
 *
 * Two implementations:
 *  - ocrspace.ts → OCR.Space free HTTP API
 *  - tesseract.ts → Tesseract.js local (Node, no API key, no network)
 *
 * Both implementations are responsible for pre-processing (rotate,
 * downscale, compress) so the API contract is "give me bytes, give
 * me text". The pre-processing helper is exported separately so the
 * job handler can use it before persistence.
 */

import type { ProviderError } from "../../types.js";

export interface OcrInput {
  /** Image bytes. Provider implementations may run Sharp on this. */
  bytes: Uint8Array;
  /** MIME hint (image/jpeg, image/png, application/pdf). */
  mimeType: string;
  /** Optional language hint, ISO 639-1 (e.g. "en", "vi"). */
  language?: string;
  /** Optional correlation id for logging. */
  correlationId?: string;
  /**
   * Optional user id for the per-user AI quota counter. When set,
   * the OCR wrapper consults the daily quota and short-circuits with
   * a non-retryable RATE_LIMITED ProviderError when the user is at
   * the limit. A null userId is treated as "no quota check" so
   * internal/operator jobs (e.g. a one-off re-embed) are not throttled.
   */
  userId?: string | null;
}

export interface OcrResult {
  text: string;
  /** Engine identifier ("ocrspace", "tesseract", "ocrspace+tesseract"). */
  engine: string;
  /** 0..1, provider's reported confidence when available. */
  confidence?: number;
  /** Detected language. */
  language?: string;
  /** Provider-specific structured errors, e.g. OCR.Space error code. */
  errorCode?: string;
}

export interface OcrOptions {
  timeoutMs?: number;
  /** Soft daily-quota enforcement (provider-specific). */
  enforceSoftLimit?: boolean;
}

export interface OcrProvider {
  recognize(input: OcrInput, opts?: OcrOptions): Promise<OcrResult>;

  /** Human-readable name + version for diagnostics. */
  info(): { name: string; model: string };
}

export type OcrProviderError = ProviderError;
