/**
 * OCR.Space provider.
 *
 * Free OCR API at https://api.ocr.space/parse/image. Free tier is
 * advertised as 25,000 requests/month with a per-IP rate limit.
 * We add a configurable DAILY soft limit
 * (OCR_SPACE_DAILY_SOFT_LIMIT, default 450) so we never blow past
 * the real quota in one user session.
 *
 * The provider expects the actual image bytes via multipart/form-data
 * so the user does not need to expose a public image URL.
 *
 * Sharp-based pre-processing (rotate, downscale) lives in the
 * application layer, not in this provider: keeping the provider
 * thin makes it easier to test in isolation.
 */

import { ProviderError } from "../../types.js";
import type { OcrInput, OcrOptions, OcrProvider, OcrResult } from "./types.js";

const OCRSPACE_URL = "https://api.ocr.space/parse/image";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface OcrSpaceDailyCounter {
  /** Returns how many calls have been made since the counter was last reset. */
  count(): number;
  /** Increment the counter after a successful call. */
  increment(): void;
  /** Reset if the calendar day has changed. */
  resetIfNewDay(): void;
  /** Soft daily limit configured for this counter. */
  limit(): number;
}

export class InMemoryDailyCounter implements OcrSpaceDailyCounter {
  private today: string;
  private n: number;

  constructor(private readonly softLimit: number) {
    this.today = new Date().toISOString().slice(0, 10);
    this.n = 0;
  }

  count(): number {
    this.resetIfNewDay();
    return this.n;
  }

  increment(): void {
    this.resetIfNewDay();
    this.n += 1;
  }

  resetIfNewDay(): void {
    const now = new Date().toISOString().slice(0, 10);
    if (now !== this.today) {
      this.today = now;
      this.n = 0;
    }
  }

  limit(): number {
    return this.softLimit;
  }
}

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000][attempt] ?? 4000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ParsedResponse {
  ParsedResults?: Array<{ ParsedText?: string }>;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ErrorDetails?: string;
  OCRExitCode?: number;
}

export class OcrSpaceProvider implements OcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly dailyCounter: OcrSpaceDailyCounter
  ) {
    if (!apiKey) throw new Error("OcrSpaceProvider: apiKey is required");
  }

  info(): { name: string; model: string } {
    return { name: "ocrspace", model: "engine=2" };
  }

  async recognize(input: OcrInput, opts?: OcrOptions): Promise<OcrResult> {
    const enforce = opts?.enforceSoftLimit ?? true;
    if (enforce && this.dailyCounter.count() >= this.dailyCounter.limit()) {
      throw new ProviderError({
        message: `OCR.Space daily soft limit reached (${this.dailyCounter.limit()})`,
        code: "RATE_LIMITED",
        provider: "ocrspace",
        retryable: false,
      });
    }
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastErr: ProviderError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const form = new FormData();
        // OCR.Space accepts base64 file as "base64Image" or a file
        // upload as "file". For ≤ 1MB the base64 path is simpler and
        // keeps the worker stateless.
        form.append("apikey", this.apiKey);
        form.append("language", input.language ?? "eng");
        form.append("isOverlayRequired", "false");
        form.append("iscreatesearchablepdf", "false");
        form.append("issearchablepdfhidetextlayer", "false");
        form.append("OCREngine", "2");
        form.append("scale", "true");
        form.append("detectOrientation", "true");
        // base64Image expects the data URL or just the base64 string.
        let binary = "";
        for (const b of input.bytes) binary += String.fromCharCode(b);
        const b64 =
          typeof btoa === "function"
            ? btoa(binary)
            : Buffer.from(input.bytes).toString("base64");
        form.append("base64Image", `data:${input.mimeType};base64,${b64}`);

        const res = await fetch(OCRSPACE_URL, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const body = (await res.json().catch(() => ({}))) as ParsedResponse;
        if (res.ok && !body.IsErroredOnProcessing) {
          const text = (body.ParsedResults ?? [])
            .map((p) => p.ParsedText ?? "")
            .join("\n")
            .trim();
          this.dailyCounter.increment();
          return {
            text,
            engine: "ocrspace",
            confidence: 0.85,
            language: input.language ?? "eng",
          };
        }
        const detail = (
          Array.isArray(body.ErrorMessage)
            ? body.ErrorMessage.join("; ")
            : body.ErrorMessage ?? body.ErrorDetails ?? ""
        ).slice(0, 200);
        if (res.status === 429) {
          lastErr = new ProviderError({
            message: `OCR.Space rate-limited: ${detail}`,
            code: "RATE_LIMITED",
            provider: "ocrspace",
            retryable: true,
          });
        } else if (res.status === 401 || res.status === 403) {
          throw new ProviderError({
            message: `OCR.Space auth failed (${res.status}): ${detail}`,
            code: "INVALID_API_KEY",
            provider: "ocrspace",
            retryable: false,
          });
        } else if (res.status >= 500) {
          lastErr = new ProviderError({
            message: `OCR.Space server error (${res.status}): ${detail}`,
            code: "PROVIDER_UNAVAILABLE",
            provider: "ocrspace",
            retryable: true,
          });
        } else {
          // 4xx other than auth: usually "E101: valid image not found"
          // or unsupported format. Treat as a hard failure so the
          // local fallback can take over.
          throw new ProviderError({
            message: `OCR.Space rejected input: ${detail || res.status}`,
            code: "INVALID_RESPONSE",
            provider: "ocrspace",
            retryable: false,
          });
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ProviderError && !err.retryable) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          lastErr = new ProviderError({
            message: "OCR.Space timeout",
            code: "TIMEOUT",
            provider: "ocrspace",
            retryable: true,
          });
        } else if (err instanceof ProviderError) {
          lastErr = err;
        } else {
          lastErr = new ProviderError({
            message: err instanceof Error ? err.message : String(err),
            code: "UNKNOWN",
            provider: "ocrspace",
            retryable: true,
          });
        }
      }
      if (attempt < 2) await sleep(backoffMs(attempt));
    }
    throw (
      lastErr ??
      new ProviderError({
        message: "OCR.Space call failed after retries",
        code: "UNKNOWN",
        provider: "ocrspace",
        retryable: false,
      })
    );
  }
}
