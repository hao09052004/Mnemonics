#!/usr/bin/env node
/**
 * Gate 08 Knowledge regression (scaffold).
 *
 * Real implementation requires a labelled golden set and Supabase access; this
 * runner provides the wiring so the gate is enforceable in CI even before the
 * golden set is finalised.
 *
 * Behaviour:
 *   - looks for quality-gates/.knowledge-regression/golden.jsonl
 *   - if missing, prints SKIP (no golden set) and exits 0
 *   - if present, executes the per-query probe using the search service URL
 *     from MNEMONICS_SEARCH_URL and asserts RecallAt10 >= 0.85 and zero
 *     cross-tenant hits.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const GOLDEN = join(ROOT, "quality-gates/.knowledge-regression/golden.jsonl");
const OUT_DIR = join(ROOT, "quality-gates/.coverage");
mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync(GOLDEN)) {
  console.log("[knowledge-regression] SKIP (no golden set; see .knowledge-regression/golden.example.jsonl)");
  process.exit(0);
}

const URL = process.env.MNEMONICS_SEARCH_URL;
if (!URL) {
  console.error("[knowledge-regression] FAIL — MNEMONICS_SEARCH_URL not set");
  process.exit(1);
}

const queries = readFileSync(GOLDEN, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));

(async () => {
  let recallSum = 0;
  let crossHits = 0;
  for (const q of queries) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${process.env.MNEMONICS_TEST_TOKEN}` },
      body: JSON.stringify({ q: q.query, limit: 10, tenant: q.tenant }),
    }).then((r) => r.json());

    const topIds = (res.hits || []).map((h) => h.id);
    const hits = (q.expected || []).some((id) => topIds.includes(id));
    recallSum += hits ? 1 : 0;

    if (q.tenant_other) {
      const cross = (res.hits || []).filter((h) => h.tenant === q.tenant_other);
      crossHits += cross.length;
    }
  }
  const recall = recallSum / Math.max(queries.length, 1);
  const report = {
    queries: queries.length,
    recall_at_10: recall,
    cross_tenant_hits: crossHits,
    threshold_recall_at_10: 0.85,
    threshold_cross_tenant_hits: 0,
    pass: recall >= 0.85 && crossHits === 0,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(OUT_DIR, `08-knowledge-regression-${stamp}.json`), JSON.stringify(report, null, 2));
  if (!report.pass) {
    console.error("[knowledge-regression] FAIL", report);
    process.exit(1);
  }
  console.log("[knowledge-regression] PASS", report);
})();
