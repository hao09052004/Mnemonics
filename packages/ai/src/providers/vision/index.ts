/**
 * Provider factory for visual embeddings.
 *
 * Today only "local" (CLIP) is supported. The architecture
 * intentionally rejects any other provider so a future PR that adds
 * a paid visual API must also flip AI_FREE_ONLY handling.
 */

import type { AiConfig } from "../../ai-config.js";
import type { VisualProvider } from "./types.js";
import { ClipLocalProvider } from "./clip.js";

export function buildVisualProvider(config: AiConfig): VisualProvider {
  switch (config.vision.provider) {
    case "local":
      return new ClipLocalProvider(config.vision.clipModel, 512);
    default: {
      const _exhaustive: never = config.vision.provider;
      throw new Error(`Unknown visual provider: ${String(_exhaustive)}`);
    }
  }
}

export type { VisualProvider, VisualInput, VisualEmbeddingResult, VisualProviderInfo } from "./types.js";
export { ClipLocalProvider } from "./clip.js";
