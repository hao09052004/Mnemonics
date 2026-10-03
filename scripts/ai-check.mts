#!/usr/bin/env node
/**
 * `pnpm ai:check` — diagnostics for the AI subsystem.
 *
 * Loads the AI config from the current env, constructs the DI
 * container, and prints a one-line status per provider. With
 * --deep it actually calls each provider with a tiny probe payload
 * to verify network reachability + auth.
 *
 * Never prints API key values. Provider status and (for OCR.Space)
 * the in-memory daily counter are the only things shown.
 */

import { deepProbe, formatSnapshot, snapshot } from "../packages/ai/src/index.ts";

async function main() {
  const deep = process.argv.includes("--deep");
  const snap = deep ? await deepProbe() : await snapshot();
  console.log(formatSnapshot(snap));
  if (deep) {
    const deepSnap = snap as ReturnType<typeof deepProbe> extends Promise<infer T> ? T : never;
    if (deepSnap.textProbe) {
      console.log(
        `Text probe ......... ${deepSnap.textProbe.ok ? "OK" : "FAIL"} — ${deepSnap.textProbe.detail}`
      );
    }
    if (deepSnap.embeddingProbe) {
      console.log(
        `Embedding probe .... ${deepSnap.embeddingProbe.ok ? "OK" : "FAIL"} — ${deepSnap.embeddingProbe.detail}`
      );
    }
  }
}

main().catch((err) => {
  console.error("ai:check failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
