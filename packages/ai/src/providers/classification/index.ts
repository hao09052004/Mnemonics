/**
 * Classifier provider factory (spec 0005 §4.4).
 *
 * Selection rule:
 *   1. If `AI_FREE_ONLY=true` (the only supported mode) AND the
 *      Gemini client is reachable at boot, return the Gemini
 *      classifier. v1.
 *   2. Otherwise (DEMO_MODE, missing key, Gemini health check
 *      failure) return the Noop classifier.
 *
 * The factory never chains a second provider on a Noop result.
 * The behaviour is "no automatic paid-model fallback" by design.
 */
import { GeminiContentClassifier } from './gemini.js';
import { NoopContentClassifier } from './noop.js';
import type { ContentClassifier } from './types.js';
import type { GeminiClient } from '../../gemini-client.js';

export function buildContentClassifier(opts: {
  freeOnly: boolean;
  apiKey: string | null;
  model: string;
  geminiClient: GeminiClient;
}): ContentClassifier {
  if (opts.freeOnly && opts.apiKey) {
    return new GeminiContentClassifier({
      apiKey: opts.apiKey,
      model: opts.model,
      client: opts.geminiClient
    });
  }
  return new NoopContentClassifier();
}

export { NoopContentClassifier, GeminiContentClassifier };
export * from './types.js';
