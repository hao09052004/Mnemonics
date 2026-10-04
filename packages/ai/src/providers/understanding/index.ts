/**
 * Understanding provider index.
 *
 * Composes:
 *   - local image description (Transformers.js)
 *   - deterministic TLDR (always-on)
 *   - optional Ollama TLDR upgrade (only when configured)
 *
 * The factory inspects the same `AiConfig` used elsewhere so the
 * zero-paid-AI guarantees are not duplicated here.
 */

import type { AiConfig } from '../../ai-config.js';
import {
  LocalImageDescriptionProvider,
  type LocalImageDescriptionProviderOptions
} from './local-image-description.js';
import { DeterministicTldrProvider } from './deterministic-tldr.js';
import { OllamaTldrProvider } from './ollama-tldr.js';
import type {
  ImageDescriptionProvider,
  TldrProvider
} from '../../understanding/types.js';

export type {
  ImageDescriptionProvider,
  ImageDescriptionInput,
  ImageDescriptionResult,
  TldrProvider,
  TldrInput,
  TldrResult
} from '../../understanding/types.js';

export { LocalImageDescriptionProvider } from './local-image-description.js';
export { DeterministicTldrProvider } from './deterministic-tldr.js';
export { OllamaTldrProvider } from './ollama-tldr.js';
export type { LocalImageDescriptionProviderOptions } from './local-image-description.js';

export interface UnderstandingProviders {
  imageDescription: ImageDescriptionProvider;
  tldr: TldrProvider;
}

export interface BuildUnderstandingOptions {
  config: AiConfig;
  imageDescription?: LocalImageDescriptionProviderOptions;
}

export function buildUnderstandingProviders(
    opts: BuildUnderstandingOptions
): UnderstandingProviders {
  const cfg = opts.config;
  const imageDescription: ImageDescriptionProvider = new LocalImageDescriptionProvider(
    opts.imageDescription ?? {
      modelName: cfg.understanding.localImageModel || undefined,
      allowDownload: cfg.understanding.allowDownload
    }
  );

  // TLDR chain: deterministic always wins the floor. The Ollama
  // provider is only mounted if explicitly enabled + reachable.
  if (cfg.understanding.tldrProvider === 'ollama') {
    return {
      imageDescription,
      tldr: new OllamaTldrProvider({
        forceCpu: cfg.ollamaForceCpu,
      })
    };
  }
  return {
    imageDescription,
    tldr: new DeterministicTldrProvider()
  };
}