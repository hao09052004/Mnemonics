/**
 * Text provider that tries a primary provider and, on ProviderError,
 * transparently retries once with a fallback. The fallback must be
 * a strictly weaker / free provider (Ollama local). The contract:
 *
 *   - if primary succeeds → return its result
 *   - if primary throws ProviderError AND fallback is configured
 *     → call fallback; on its success, return; on its throw, surface
 *     the LAST error (the fallback's), since that is what the user
 *     would most want to act on
 *   - if primary throws ProviderError AND no fallback is configured
 *     → rethrow the primary's error
 *
 * Network-layer transient failures (PROVIDER_UNAVAILABLE, RATE_LIMITED,
 * TIMEOUT) are deliberately retried via the fallback, because by
 * definition the primary was unreachable. Authorisation errors
 * (INVALID_API_KEY) will also fall through to the fallback, which is
 * the right thing for a billing-failure scenario.
 *
 * failOpen semantics: each provider's own failOpen handling runs
 * independently. This wrapper does NOT swallow ProviderError just
 * because failOpen=true — it lets the fallback have its own say.
 */

import { ProviderError } from "../../types.js";
import type {
  TextProvider,
  TextProviderInfo,
  TextGenerationOptions,
} from "./types.js";

export class FallingBackTextProvider implements TextProvider {
  constructor(
    private readonly primary: TextProvider,
    private readonly fallback: TextProvider,
    /** Optional log; called on every fallback activation. */
    private readonly onFallback?: (
      err: ProviderError,
      kind: "tags" | "summarize"
    ) => void
  ) {}

  async generateTags(content: string, opts?: TextGenerationOptions): Promise<string[]> {
    return this.run("tags", opts, (p, o) => p.generateTags(content, o));
  }

  async summarize(content: string, opts?: TextGenerationOptions): Promise<string> {
    return this.run("summarize", opts, (p, o) => p.summarize(content, o));
  }

  info(): TextProviderInfo {
    return {
      name: `${this.primary.info().name}+${this.fallback.info().name}`,
      model: this.primary.info().model,
    };
  }

  private async run<T>(
    kind: "tags" | "summarize",
    opts: TextGenerationOptions | undefined,
    call: (p: TextProvider, o: TextGenerationOptions | undefined) => Promise<T>
  ): Promise<T> {
    try {
      return await call(this.primary, opts);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      console.warn(
        `[ai/text] primary provider '${this.primary.info().name}' failed (${err.code}: ${err.message.slice(0, 120)}); falling back to '${this.fallback.info().name}'`
      );
      this.onFallback?.(err, kind);
      // Fallback gets a fresh timeout: the primary already burned
      // most of the caller's budget. We pass failOpen=true so the
      // fallback's heuristic last-resort path can run if even
      // Ollama is down.
      const fbOpts: TextGenerationOptions = opts
        ? { ...opts, failOpen: true }
        : { failOpen: true };
      return await call(this.fallback, fbOpts).catch((fbErr) => {
        if (fbErr instanceof ProviderError) throw fbErr;
        // The fallback returned a non-ProviderError throw. Surface
        // it wrapped, with the primary's error preserved as cause.
        throw new ProviderError({
          message:
            fbErr instanceof Error ? fbErr.message : String(fbErr),
          code: "UNKNOWN",
          provider: this.fallback.info().name,
          retryable: false,
          cause: err,
        });
      });
    }
  }
}
