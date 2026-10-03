/**
 * Shared types for the @mnemonics/ai package.
 *
 * This package owns the provider interface surface that the rest of
 * the application talks to. Every consumer (the OCR job handler, the
 * tag job handler, the embed job handler, the search route, the
 * Spaces suggester) should depend on these types, NOT on a concrete
 * provider implementation.
 *
 * Why: we want to be able to swap Gemini ↔ OpenAI ↔ local CLIP
 * without touching business logic, and we want AI_FREE_ONLY=true to
 * be enforced at the type-boundary, not at scattered `if (process.env…)`
 * checks.
 */

/**
 * Provider failure category. Consumers should branch on this rather
 * than on string error messages, so the same retry / fallback policy
 * works regardless of which provider surfaced the error.
 */
export type ProviderFailureCode =
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_API_KEY"
  | "INVALID_RESPONSE"
  | "INPUT_TOO_LARGE"
  | "TIMEOUT"
  | "UNKNOWN";

export class ProviderError extends Error {
  readonly code: ProviderFailureCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(args: {
    message: string;
    code: ProviderFailureCode;
    provider: string;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "ProviderError";
    this.code = args.code;
    this.provider = args.provider;
    this.retryable = args.retryable;
    this.retryAfterMs = args.retryAfterMs;
  }
}

/**
 * Truncate a string for transport to a remote AI provider.
 *
 * 8 KB is a safe default for a 1536-d text embedding input; for
 * Gemini text generation the input budget is much larger but we still
 * prefer to keep requests small.
 */
export function truncate(s: string, maxChars = 8000): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

/**
 * Stable hash for cache keys. The cache layer keys on sha256 of the
 * provider-relevant inputs (title + rawText + ocrText + provider + model).
 * This avoids re-sending identical content to paid providers, and gives
 * us deterministic tests.
 */
export async function contentHash(parts: Array<string | undefined | null>): Promise<string> {
  const norm = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => p.trim())
    .join("\n\n");
  const buf = new TextEncoder().encode(norm);
  // Node 18+ has globalThis.crypto.subtle; use it instead of pulling
  // a heavy hash dependency.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
