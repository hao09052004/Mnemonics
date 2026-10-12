/**
 * Local CLIP visual embedding provider.
 *
 * Uses @huggingface/transformers with the Xenova/clip-vit-base-patch32
 * model. Runs entirely on-device / in the Node process — no API key,
 * no network call after the model is downloaded once and cached.
 *
 * The actual model load is implemented in M7 (visual embeddings
 * milestone). This file ships the interface and a "not loaded" stub
 * so consumers can wire the type without dragging in the ~150MB
 * dependency today.
 *
 * To activate the real model:
 *   pnpm --filter @mnemonics/ai add @huggingface/transformers
 * and replace the body of `embed` with a pipeline('image-feature-extraction', ...)
 * call. The interface is intentionally minimal so the swap is local.
 */

import type {
  VisualProvider,
  VisualInput,
  VisualEmbeddingResult,
  VisualProviderInfo,
} from "./types.js";

const DEFAULT_DIMENSIONS = 512;
const DEFAULT_MODEL = "Xenova/clip-vit-base-patch32";

export class ClipLocalProvider implements VisualProvider {
  private loaded = false;

  constructor(
    private readonly model: string = DEFAULT_MODEL,
    private readonly dimensions: number = DEFAULT_DIMENSIONS
  ) {}

  async warmup(): Promise<void> {
    if (this.loaded) return;
    // M7: instantiate the transformers.js pipeline here. Until
    // then, this is a no-op so typechecking and unit tests do not
    // require the heavy dependency.
    this.loaded = false;
  }

  async embed(_input: VisualInput): Promise<VisualEmbeddingResult> {
    if (!this.loaded) {
      throw new Error(
        "ClipLocalProvider: model not loaded. Call warmup() first. " +
          "Real CLIP loading ships in milestone 7."
      );
    }
    // unreachable until M7
    throw new Error("ClipLocalProvider.embed: not implemented (M7)");
  }

  info(): VisualProviderInfo {
    return {
      name: "clip-local",
      model: this.model,
      dimensions: this.dimensions,
      loaded: this.loaded,
    };
  }
}
