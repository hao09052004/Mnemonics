/**
 * Local image-description provider.
 *
 * Picks the smallest viable caption model that runs on CPU. We
 * deliberately do NOT hard-code a model: the project may run on
 * hardware where the largest variant never warms up. The provider
 * falls back through three families in order:
 *
 *   1. transformers.js with `Xenova/vit-gpt2-image-captioning`
 *      (~250MB, MIT. Pure JS, no GPU required. Runs in the Node
 *      process. Average 1-3s on CPU for a 384x384 image.)
 *   2. transformers.js with `Xenova/Salesforce/blip-image-captioning-base`
 *      (~440MB, MIT. Higher quality; slower on cold start.)
 *   3. `placeholder` — deterministic short caption used only in
 *      demo / test environments where the model download is
 *      disabled.
 *
 * The chosen model is recorded in `info().model`. Diagnostics
 * (`pnpm ai:check`) can show which one is loaded.
 *
 * Why no `image-captioning-large`? RAM cost on a developer
 * laptop is >2GB and cold-start >30s. Not worth it for a "second
 * brain" personal tool — small models already produce useful
 * short descriptions after a one-line prompt instruction.
 */

import { ProviderError } from '../../types.js';
import type {
  ImageDescriptionProvider,
  ImageDescriptionInput,
  ImageDescriptionResult
} from '../../understanding/types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type TransformersModule = any;
type PipelineFn = (task: string, model?: string) => Promise<any>;

interface TransformersRuntime {
  pipeline: PipelineFn;
  RawImage?: {
    fromBlob?: (blob: Blob) => Promise<any>;
    read?: (input: unknown) => Promise<any>;
  };
  env?: {
    cacheDir?: string;
    allowLocalModels?: boolean;
    useFsCache?: boolean;
  };
}

/**
 * Decode raw image bytes into the `RawImage` instance the
 * transformers.js image processors expect.
 *
 * `RawImage.fromBlob` is the only decoder that handles every format we
 * accept (jpeg / png / webp) in Node, so it is preferred. `RawImage.read`
 * is the documented fallback and accepts a Blob too. If neither exists
 * we surface an explicit error rather than letting the pipeline throw a
 * confusing "Unsupported input type: object".
 */
async function toRawImage(
  rt: TransformersRuntime | null,
  bytes: Uint8Array,
  mimeType: string
): Promise<unknown> {
  if (!rt) throw new Error('transformers runtime is not available');
  const RawImageCtor = rt.RawImage;
  if (!RawImageCtor) {
    throw new Error('transformers runtime does not expose RawImage');
  }

  // Copy into a fresh ArrayBuffer: the incoming view may be a slice of
  // a larger Node Buffer, and Blob would otherwise capture the padding.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType || 'image/jpeg' });

  if (typeof RawImageCtor.fromBlob === 'function') {
    return RawImageCtor.fromBlob(blob);
  }
  if (typeof RawImageCtor.read === 'function') {
    return RawImageCtor.read(blob);
  }
  throw new Error('RawImage has neither fromBlob nor read');
}

let cachedRuntime: TransformersRuntime | null = null;
let cachedPipeline: any = null;
let cachedModelName: string | null = null;

const MODEL_CANDIDATES: string[] = [
  'Xenova/vit-gpt2-image-captioning',
  'Xenova/Salesforce/blip-image-captioning-base'
];

async function tryImportTransformers(): Promise<TransformersRuntime | null> {
  try {
    const mod = (await import('@huggingface/transformers')) as TransformersModule;
    if (typeof mod.pipeline === 'function') return mod;
    const alt = (mod as { default?: TransformersRuntime }).default;
    if (alt && typeof alt.pipeline === 'function') return alt;
    return null;
  } catch {
    return null;
  }
}

async function loadPipeline(): Promise<{ pipeline: any; modelName: string } | null> {
  if (cachedPipeline && cachedModelName) {
    return { pipeline: cachedPipeline, modelName: cachedModelName };
  }
  const rt = await tryImportTransformers();
  if (!rt) return null;
  for (const candidate of MODEL_CANDIDATES) {
    try {
      const pipe = await rt.pipeline('image-to-text', candidate);
      cachedPipeline = pipe;
      cachedModelName = candidate;
      cachedRuntime = rt;
      return { pipeline: pipe, modelName: candidate };
    } catch (err) {
      console.warn(
        `[ai/understanding] failed to load ${candidate}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return null;
}

export interface LocalImageDescriptionProviderOptions {
  /** Override the model name. Useful for tests. */
  modelName?: string;
  /** When true, the provider tries to download the model on first call. */
  allowDownload?: boolean;
}

export class LocalImageDescriptionProvider implements ImageDescriptionProvider {
  private readonly modelName?: string;
  private readonly allowDownload: boolean;
  private status: 'not_loaded' | 'loading' | 'ready' | 'failed' = 'not_loaded';

  constructor(opts: LocalImageDescriptionProviderOptions = {}) {
    this.modelName = opts.modelName;
    this.allowDownload = opts.allowDownload ?? true;
  }

  /**
   * Probe + (optionally) warm up the model. Safe to call multiple
   * times; subsequent calls are no-ops until the underlying load
   * finishes. We do NOT block here in production — the worker can
   * decide to warm up at boot or on first use.
   */
  async warmup(): Promise<void> {
    if (this.status === 'ready' || this.status === 'loading') return;
    this.status = 'loading';
    try {
      const pipe = await loadPipeline();
      this.status = pipe ? 'ready' : 'failed';
    } catch {
      this.status = 'failed';
    }
  }

  async describe(input: ImageDescriptionInput): Promise<ImageDescriptionResult> {
    if (!this.allowDownload) {
      // Test path: we deliberately do not touch the model cache.
      return this.placeholder(input);
    }
    if (this.status === 'not_loaded') await this.warmup();
    if (this.status === 'failed' || !cachedPipeline) {
      return this.placeholder(input);
    }
    try {
      // transformers.js only accepts a RawImage / Blob / URL / canvas.
      // Passing raw bytes (`Uint8Array`) makes the processor throw
      // "Unsupported input type: object", which is why every caption
      // used to fail or silently degrade to the placeholder.
      const image = await toRawImage(cachedRuntime, input.bytes, input.mimeType);
      const out = await cachedPipeline(image);
      // transformers.js returns an array of `{ generated_text }` rows
      // (or, depending on the model, a single object). Normalise.
      const caption = extractCaption(out);
      if (!caption) return this.placeholder(input);
      return {
        caption,
        confidence: null,
        model: cachedModelName ?? this.modelName ?? 'local',
        provider: 'local'
      };
    } catch (err) {
      throw new ProviderError({
        message: `Local image description failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'PROVIDER_UNAVAILABLE',
        provider: 'local',
        retryable: true,
        cause: err
      });
    }
  }

  info() {
    return {
      name: 'local' as const,
      model: cachedModelName ?? this.modelName ?? 'pending',
      loaded: this.status === 'ready'
    };
  }

  /** Cheap deterministic placeholder so dev / demo never blocks. */
  private placeholder(_input: ImageDescriptionInput): ImageDescriptionResult {
    return {
      caption: 'Một hình ảnh đã được lưu cùng memory này.',
      confidence: 0.0,
      model: 'placeholder-v1',
      provider: 'local'
    };
  }
}

function extractCaption(out: unknown): string | null {
  if (!out) return null;
  if (Array.isArray(out)) {
    const first = out[0];
    if (first && typeof first === 'object' && 'generated_text' in first) {
      return String((first as { generated_text: unknown }).generated_text).trim();
    }
    if (typeof first === 'string') return first.trim();
  }
  if (typeof out === 'object' && out !== null && 'generated_text' in (out as Record<string, unknown>)) {
    return String((out as { generated_text: unknown }).generated_text).trim();
  }
  return null;
}