/**
 * Content classifier — type/attribute extraction over a captured item.
 *
 * Sits between the classify job handler and the AI provider
 * implementation. The interface is intentionally narrow: it takes
 * the same `ClassificationInput` the handler already has and
 * returns either a structured result (the dashboard's
 * "Detected: <type>" chip + the filter chips) or an error code
 * (the handler decides what to do — typically write a `failed`
 * or `skipped` row).
 *
 * Three implementations exist today:
 *
 *  - `NoopContentClassifier` — the offline / no-Gemini-key
 *    fallback. Always returns `status='skipped'`, no detected
 *    type. The dashboard shows "Detected: still processing".
 *  - `GeminiContentClassifier` — real provider (not in this
 *    commit; see follow-up). Calls the Gemini Flash Lite model
 *    and merges with the item's existing user-set attributes.
 *  - `HeuristicContentClassifier` — pure-JS fallback that
 *    inspects the title + body for type hints; not in this
 *    commit either.
 *
 * The Noop classifier is the one this commit ships, because the
 * acceptance test that gates the M4 milestone must run in CI
 * without a `GEMINI_API_KEY`.
 *
 * `DetectedType` is intentionally duplicated here (not imported
 * from `@mnemonics/database`) because `@mnemonics/ai` is a
 * leaf-level package and the database package depends on the
 * shared package — not the other way around. A future change
 * that wants a single source of truth should lift this type into
 * `@mnemonics/shared` and re-export it from both.
 */
export const DETECTED_TYPES = [
  'article', 'product', 'recipe', 'video', 'quote', 'highlight',
  'webpage', 'image', 'note', 'document', 'other'
] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

export interface ClassificationInput {
  itemId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  sourceUrl?: string | null;
  /** Optional JSON-LD / Open Graph metadata from the page. */
  sourceMetadata?: Record<string, unknown>;
  /** Hash of the input the handler built. Detects reclassify. */
  contentHash: string;
}

export interface ClassificationResult {
  detectedType: DetectedType | null;
  category: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  entities: unknown[];
  evidence: Record<string, string>;
  confidence: number | null;
  status: 'ready' | 'failed' | 'skipped';
  errorCode: string | null;
}

/**
 * Noop classifier.
 *
 * The contract is: do not throw, always return a row. When the
 * provider is unavailable (no Gemini key, offline deploy,
 * explicit `AI_FREE_ONLY=1`) the worker still needs to write a
 * row so the dashboard can render a "Detected: still processing"
 * pill instead of a missing-pill layout.
 *
 * `errorCode='NOOP_PROVIDER'` is the marker the dashboard's
 * "still processing" copy keys off, so the value is part of the
 * public surface.
 */
export class NoopContentClassifier {
  async classify(_input: ClassificationInput): Promise<ClassificationResult> {
    return {
      detectedType: null,
      category: null,
      description: null,
      attributes: {},
      entities: [],
      evidence: {},
      confidence: null,
      status: 'skipped',
      errorCode: 'NOOP_PROVIDER'
    };
  }
}
