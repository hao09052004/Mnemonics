/**
 * Noop / free-tier fallback classifier (spec 0005 §4.4).
 *
 * The product runs on `AI_FREE_ONLY=true`; this is the only
 * provider in the runtime. The output is always `status:'skipped'`
 * with a null `detected_type`. The repository row still gets
 * written so the UI knows a classification was attempted and the
 * search layer can fall back to the canonical `type`.
 *
 * Implements spec 0005 §4.4 "no automatic paid-model fallback":
 * the AI service does NOT chain a second provider on a noop
 * result.
 */
import type {
  ContentClassifier,
  ContentClassifierInfo,
  ClassificationInput,
  ClassificationResult
} from './types.js';

export class NoopContentClassifier implements ContentClassifier {
  async classify(_input: ClassificationInput): Promise<ClassificationResult> {
    return {
      detectedType: null,
      category: null,
      description: null,
      attributes: {},
      entities: [],
      evidence: {},
      confidence: null,
      classifierVersion: 'v1-noop',
      status: 'skipped'
    };
  }

  info(): ContentClassifierInfo {
    return {
      name: 'noop',
      model: 'noop',
      version: 'v1-noop',
      isFallback: true
    };
  }
}
