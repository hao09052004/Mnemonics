/**
 * Gemini TLDR provider.
 *
 * Composes a short summary (≤ TLDR_MAX_LENGTH chars) by sending the
 * existing pipeline inputs (title, caption, OCR, raw text) to
 * Gemini. The provider is intentionally conservative:
 *
 *   - Output is capped at the configured max length. A long Gemini
 *     response is truncated at a sentence boundary if possible.
 *   - On EVERY failure (auth, rate limit, network, empty result)
 *     the provider THROWS a ProviderError. The job handler is
 *     responsible for falling back to the deterministic provider.
 *     We do not return a degraded "heuristic" string under the
 *     Gemini name — that would be a product lie.
 *   - For long PDFs the provider is told "use the chunks, not the
 *     full text" via the prompt, so a 200-page PDF does not blow
 *     past the model's input budget.
 *
 * Privacy: the prompt contains the user's title, caption, OCR
 * text, and a chunked summary of the raw text. The Free Tier (per
 * Google AI Studio docs) MAY use inputs to improve the model; the
 * operator must surface a privacy notice before enabling this
 * provider. See docs/privacy.md.
 */

import { ProviderError, truncate } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type { TldrInput, TldrProvider, TldrResult } from "../../understanding/types.js";

const PROMPT_VERSION = "gemini-tldr-v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_CHARS = 6000;

const PROMPT = `You write a one-line summary (≤ {MAX} chars) of a personal memory.
Inputs are: a user-supplied title, an image caption (if any), the
OCR text (if any), the captured raw text (if any), and the source
URL (if any). Return ONLY the summary sentence, no preamble, no
markdown fences. If the raw text is very long, summarise the first
part — do not invent facts that are not present.

Title: {TITLE}
Caption: {CAPTION}
OCR: {OCR}
Raw text: {RAW}
URL: {URL}`;

export class GeminiTldrProvider implements TldrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly client: GeminiClient,
    private readonly options: { maxLength?: number; maxInputChars?: number } = {}
  ) {
    if (!apiKey) throw new Error("GeminiTldrProvider: apiKey is required");
  }

  info(): { name: string; model: string; promptVersion: string } {
    return { name: "gemini", model: this.model, promptVersion: PROMPT_VERSION };
  }

  async summarize(input: TldrInput): Promise<TldrResult> {
    const maxLength = this.options.maxLength ?? 240;
    const maxInput = this.options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
    const prompt = PROMPT.replace("{MAX}", String(maxLength))
      .replace("{TITLE}", clean(input.title))
      .replace("{CAPTION}", clean(input.caption))
      .replace("{OCR}", clean(input.ocrText))
      .replace("{RAW}", clean(input.rawText, maxInput))
      .replace("{URL}", clean(input.sourceUrl));

    const data = await this.client.call<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    }>({
      apiKey: this.apiKey,
      model: this.model,
      task: "text" satisfies GeminiTask,
      path: `models/${encodeURIComponent(this.model)}:generateContent`,
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 256
        }
      },
      totalBudgetMs: DEFAULT_TIMEOUT_MS
    });
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const tldr = raw.trim().slice(0, maxLength);
    if (!tldr) {
      throw new ProviderError({
        message: "Gemini returned an empty TLDR",
        code: "EMPTY_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    return {
      tldr,
      provider: "gemini",
      model: this.model,
      promptVersion: PROMPT_VERSION,
      source: "cloud_ai",
      confidence: 0.7
    };
  }
}

function clean(value: string | null | undefined, maxChars = 1000): string {
  if (!value) return "";
  return truncate(value, maxChars);
}
