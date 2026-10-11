/**
 * Gemini content classifier (spec 0005 §4.3).
 *
 * Free-Tier only. Reuses the shared GeminiClient and prompts
 * the model with a strict JSON schema. The actual classification
 * lives in this provider; the job handler is responsible for
 * persisting the result and recording the provider/model/version
 * fields.
 *
 * Evidence priority (spec 0005 §5.5):
 *   user > structured_data > html_meta > dom > extracted_text
 *   > ocr > gemini_vision > gemini_text
 *
 * Provenance is assigned locally after the model call, NOT by
 * Gemini: the model is told "for each field, copy the raw string
 * you saw" and we mark `evidence[field] = 'gemini_text'` by
 * default unless the field is also present in `sourceMetadata`
 * (in which case the more privileged source wins).
 */
import { ProviderError } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type {
  ContentClassifier,
  ContentClassifierInfo,
  ClassificationInput,
  ClassificationResult,
  EvidenceSource
} from './types.js';
import {
  detectedTypeSchema,
  classificationResultSchema
} from './types.js';

const VERSION = 'v1';
const MAX_BODY_CHARS = 8_000;

const KINDS = [
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
] as const;

interface GeminiContentClassifierOptions {
  apiKey: string;
  model: string;
  client: GeminiClient;
  totalBudgetMs?: number;
}

export class GeminiContentClassifier implements ContentClassifier {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly client: GeminiClient;
  private readonly totalBudgetMs: number | undefined;

  constructor(opts: GeminiContentClassifierOptions) {
    if (!opts.apiKey) {
      throw new Error('GeminiContentClassifier: apiKey is required');
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.client = opts.client;
    this.totalBudgetMs = opts.totalBudgetMs;
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const truncated = input.body.length > MAX_BODY_CHARS
      ? input.body.slice(0, MAX_BODY_CHARS) + '\n\n[truncated]'
      : input.body;
    const prompt = buildPrompt(input.title, truncated, input.sourceUrl);
    const raw = await this.callGeminiJson(prompt);
    const kindRaw = (raw as any).detectedType ?? 'other';
    const kindParse = detectedTypeSchema.safeParse(kindRaw);
    const detectedType = kindParse.success ? kindParse.data : 'other';

    const candidates: Record<string, unknown> = {
      detectedType,
      category: typeof (raw as any).category === 'string' ? (raw as any).category : null,
      description: typeof (raw as any).description === 'string' ? (raw as any).description : null,
      attributes: isPlainObject((raw as any).attributes) ? (raw as any).attributes : {},
      entities: Array.isArray((raw as any).entities) ? (raw as any).entities : [],
      confidence: typeof (raw as any).confidence === 'number'
        ? Math.min(1, Math.max(0, (raw as any).confidence))
        : null
    };

    const evidence = assignEvidence(candidates, input.sourceMetadata);

    return classificationResultSchema.parse({
      ...candidates,
      evidence,
      classifierVersion: VERSION,
      status: 'ready'
    });
  }

  info(): ContentClassifierInfo {
    return {
      name: 'gemini',
      model: this.model,
      version: VERSION,
      isFallback: false
    };
  }

  private async callGeminiJson(prompt: string): Promise<unknown> {
    const res = await this.client.call<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    }>({
      apiKey: this.apiKey,
      model: this.model,
      task: 'text' satisfies GeminiTask,
      path: `models/${encodeURIComponent(this.model)}:generateContent`,
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              detectedType: { type: 'string', enum: KINDS as unknown as string[] },
              category: { type: 'string' },
              description: { type: 'string' },
              attributes: { type: 'object' },
              entities: { type: 'array', items: { type: 'object' } },
              confidence: { type: 'number' }
            },
            required: ['detectedType', 'description']
          }
        }
      },
      totalBudgetMs: this.totalBudgetMs
    });
    const candidate = res.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      throw new ProviderError({
        message: `Gemini returned no text (blockReason=${
          res.promptFeedback?.blockReason ?? 'unknown'
        }, finishReason=${candidate?.finishReason ?? 'unknown'})`,
        code: 'INVALID_RESPONSE',
        provider: 'gemini',
        retryable: false
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError({
        message: 'Gemini returned non-JSON for classifier response',
        code: 'INVALID_RESPONSE',
        provider: 'gemini',
        retryable: false
      });
    }
  }
}

function buildPrompt(title: string, body: string, sourceUrl: string | null): string {
  return [
    'You are a content classifier for a personal knowledge base.',
    'Classify the following captured item into one of:',
    KINDS.join(', ') + '.',
    'Respond ONLY with the JSON object described in the schema.',
    '',
    `TITLE: ${title || '(untitled)'}`,
    sourceUrl ? `URL: ${sourceUrl}` : 'URL: (none)',
    '---',
    body
  ].join('\n');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assignEvidence(
  candidates: Record<string, unknown>,
  sourceMetadata: Record<string, unknown> | null
): Record<string, EvidenceSource> {
  const out: Record<string, EvidenceSource> = {};
  const sm = (sourceMetadata || {}) as Record<string, any>;
  for (const [field, value] of Object.entries(candidates)) {
    if (value === null || value === undefined) continue;
    let source: EvidenceSource = 'gemini_text';
    if (sm && hasStructuredField(sm, field)) {
      source = 'structured_data';
    } else if (sm && hasHtmlMetaField(sm, field)) {
      source = 'html_meta';
    }
    out[field] = source;
  }
  return out;
}

function hasStructuredField(sm: Record<string, any>, field: string): boolean {
  const ld = sm.jsonLd;
  if (ld && typeof ld === 'object' && field in ld) return true;
  return false;
}

function hasHtmlMetaField(sm: Record<string, any>, field: string): boolean {
  const meta = sm.openGraph || sm.metaTags;
  if (meta && typeof meta === 'object' && field in meta) return true;
  return false;
}
