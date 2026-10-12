/**
 * Text generation / AI metadata provider interface.
 *
 * Used for: tag generation, summaries, content-type classification,
 * suggested Space titles. NOT used for arbitrary long-form generation.
 *
 * Implementations must:
 * - never throw raw stack traces — wrap failures in ProviderError
 * - respect the timeout passed in opts
 * - truncate inputs to the model budget before sending
 * - return empty arrays (not throw) on transient failures when
 *   `failOpen` is true, so the calling handler can still mark the
 *   item as `ready` with heuristic fallbacks
 */

import type { ProviderError } from "../../types.js";

export interface TextGenerationOptions {
  /** Hard timeout for the whole call including retries. */
  timeoutMs?: number;
  /** When true, return [] on provider error instead of throwing. */
  failOpen?: boolean;
  /** Provider-specific hints (model, temperature, max output tokens). */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Optional user id for the per-user AI quota counter. When set,
   * the call short-circuits with a non-retryable RATE_LIMITED
   * ProviderError when the user is at the daily cap. A null
   * userId skips the check (e.g. for internal/operator jobs).
   */
  userId?: string | null;
}

export interface TextProviderInfo {
  name: string;
  model: string;
}

export interface TextProvider {
  /**
   * Generate short tags for the given content. Returned tags should
   * be lowercase, kebab-case, ≤ 32 chars, deduplicated.
   */
  generateTags(
    content: string,
    opts?: TextGenerationOptions
  ): Promise<string[]>;

  /**
   * Short one-line summary of the content. Optional — implementations
   * that don't support summarisation may return an empty string.
   */
  summarize(
    content: string,
    opts?: TextGenerationOptions
  ): Promise<string>;

  /** Provider metadata for diagnostics. */
  info(): TextProviderInfo;
}

export type TextProviderError = ProviderError;
