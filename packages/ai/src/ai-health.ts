/**
 * Health / diagnostics for the AI subsystem.
 *
 * Two layers:
 *  - cheap: read config + provider info() (no network)
 *  - deep: actually call each provider with a tiny probe payload
 *
 * The `pnpm ai:check` script wires the cheap version by default and
 * uses --deep for live verification.
 */

import { createAiService, type AiService, type AiHealthSnapshot } from "./ai-service.js";

export type { AiHealthSnapshot } from "./ai-service.js";

export async function snapshot(): Promise<AiHealthSnapshot> {
  const svc = await createAiService();
  return svc.health();
}

export async function deepProbe(svc?: AiService): Promise<AiHealthSnapshot & {
  textProbe?: { ok: boolean; detail: string };
  embeddingProbe?: { ok: boolean; detail: string };
}> {
  const service = svc ?? (await createAiService());
  const snap = await service.health();
  const out: AiHealthSnapshot & {
    textProbe?: { ok: boolean; detail: string };
    embeddingProbe?: { ok: boolean; detail: string };
  } = { ...snap };
  try {
    await service.text.generateTags("probe", { timeoutMs: 5000, failOpen: true });
    out.textProbe = { ok: true, detail: "ok" };
  } catch (err) {
    out.textProbe = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const vec = await service.embeddings.embedOne("probe", { timeoutMs: 5000 });
    out.embeddingProbe = {
      ok: true,
      detail: `${vec.length} dimensions`,
    };
  } catch (err) {
    out.embeddingProbe = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return out;
}

export function formatSnapshot(snap: AiHealthSnapshot): string {
  const ok = (b: boolean) => (b ? "OK" : "UNAVAILABLE");
  const lines = [
    `Gemini text ........ ${ok(snap.textReady)} (${snap.config.text})`,
    `Gemini embeddings .. ${ok(snap.embeddingsReady)} (${snap.config.embeddings})`,
    `OCR.Space .......... ${ok(snap.ocrReady)} (${snap.config.ocr})` +
      (typeof snap.ocrDailyCount === "number" && typeof snap.ocrDailyLimit === "number"
        ? ` — ${snap.ocrDailyCount}/${snap.ocrDailyLimit} today`
        : ""),
    `Local OCR fallback . ${snap.config.ocr.includes("tesseract") ? "OK" : "OK (available on failure)"}`,
    `CLIP model ......... ${ok(snap.visualReady)} (${snap.config.visual})`,
    `Mode ............... ${snap.config.freeOnly ? "FREE-ONLY" : "PAID OK"}` +
      (snap.config.demoMode ? " (DEMO)" : ""),
  ];
  return lines.join("\n");
}
