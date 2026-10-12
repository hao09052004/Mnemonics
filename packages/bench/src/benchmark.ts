/**
 * M4 — benchmark runner.
 *
 * For every query in the dataset, runs the real
 * `runSearch()` and computes Recall@5, Precision@5,
 * MRR@10, and per-leg contributions. The report's
 * baselines are pinned in `assertBenchBaselines()` and
 * the function throws if a regression drops the numbers.
 */
import type { Pool } from 'pg';
import {
  parseQuery,
  runSearch,
  type SearchRequest,
  type SearchResponse
} from '@mnemonics/database';
import type { Dataset, BenchmarkQuery } from './dataset.js';
import type { SeederResult } from './seeder.js';

export interface BenchmarkOptions {
  pool: Pool;
  seeder: SeederResult;
  dataset: Dataset;
  /** Cap on top-K when computing metrics. Default 5. */
  topK?: number;
  /** Disable the `embedOne` call. The default keeps it on
   *  so the semantic leg contributes. */
  disableEmbeddings?: boolean;
  /** Optional embeddings provider. When undefined and
   *  `disableEmbeddings` is false, the benchmark uses
   *  lexical-only via the noop guard in `runSearch`. */
  embeddings?: import('@mnemonics/database').EmbeddingLike;
}

export interface BenchmarkQueryResult {
  id: string;
  labels: BenchmarkQuery['labels'];
  /** 0..1: fraction of relevant_ids in the top K. */
  recall: number;
  /** 0..1: fraction of top K that are relevant. */
  precision: number;
  /** 0..1: 1/rank of the first relevant hit, capped at 10. */
  mrr: number;
  hitIds: string[];
}

export interface BenchmarkReport {
  total: number;
  topK: number;
  recallAt5: number;
  precisionAt5: number;
  mrrAt10: number;
  perQuery: BenchmarkQueryResult[];
  legCounts: { lex: number; sem: number; struct: number; chunk: number };
}

const BASELINES = {
  recallAt5: 0.5,
  precisionAt5: 0.5,
  mrrAt10: 0.4
};

export async function runBenchmark(opts: BenchmarkOptions): Promise<BenchmarkReport> {
  const topK = opts.topK ?? 5;
  const perQuery: BenchmarkQueryResult[] = [];
  const legCounts = { lex: 0, sem: 0, struct: 0, chunk: 0 };

  for (const query of opts.dataset.queries) {
    // Apply the same deterministic parser the search route
    // applies. Without this, natural-language queries that
    // depend on the parser (e.g. "recipes this week") would
    // skip the structured leg entirely.
    const parsed = parseQuery(query.q);
    const request: SearchRequest = {
      q: parsed.residualQ || query.q,
      filters: parsed.structured
        ? {
            ...(parsed.captured_after ? { captured_after: parsed.captured_after } : {}),
            ...(parsed.captured_before ? { captured_before: parsed.captured_before } : {}),
            structured: parsed.structured
          }
        : undefined,
      limit: topK,
      offset: 0
    };
    const response: SearchResponse = await runSearch(
      {
        pool: opts.pool,
        ...(opts.embeddings ? { embeddings: opts.embeddings } : {})
      },
      opts.seeder.userId,
      request
    );
    legCounts.lex += response.explain?.lexResults ?? 0;
    legCounts.sem += response.explain?.semResults ?? 0;
    legCounts.struct += response.explain?.structResults ?? 0;
    legCounts.chunk += response.explain?.chunkResults ?? 0;

    const relevantSet = new Set(query.relevant_ids);
    const hitIds = response.hits.map((h) => h.id);
    // Map back to dataset-side ids so the result is stable
    // across re-seedings.
    const reverse = new Map<string, string>();
    for (const [ds, real] of opts.seeder.idMap) {
      reverse.set(real, ds);
    }
    const datasetHitIds = hitIds.map((id) => reverse.get(id) ?? id);
    const datasetHits = datasetHitIds.map((id) => relevantSet.has(id));

    const recall =
      relevantSet.size === 0
        ? 0
        : datasetHits.filter(Boolean).length / relevantSet.size;
    const precision =
      datasetHits.length === 0
        ? 0
        : datasetHits.filter(Boolean).length / datasetHits.length;
    let firstRelevantRank = -1;
    for (let i = 0; i < datasetHits.length; i += 1) {
      if (datasetHits[i]) {
        firstRelevantRank = i + 1;
        break;
      }
    }
    const mrr =
      firstRelevantRank <= 0
        ? 0
        : 1 / Math.min(firstRelevantRank, 10);

    perQuery.push({
      id: query.id,
      labels: query.labels,
      recall,
      precision,
      mrr,
      hitIds: datasetHitIds
    });
  }

  const report: BenchmarkReport = {
    total: perQuery.length,
    topK,
    recallAt5: mean(perQuery.map((q) => q.recall)),
    precisionAt5: mean(perQuery.map((q) => q.precision)),
    mrrAt10: mean(perQuery.map((q) => q.mrr)),
    perQuery,
    legCounts
  };

  assertBenchBaselines(report);
  return report;
}

export function assertBenchBaselines(report: BenchmarkReport): void {
  const violations: string[] = [];
  if (report.recallAt5 < BASELINES.recallAt5) {
    violations.push(
      `recallAt5 ${report.recallAt5.toFixed(3)} < ${BASELINES.recallAt5}`
    );
  }
  if (report.precisionAt5 < BASELINES.precisionAt5) {
    violations.push(
      `precisionAt5 ${report.precisionAt5.toFixed(3)} < ${BASELINES.precisionAt5}`
    );
  }
  if (report.mrrAt10 < BASELINES.mrrAt10) {
    violations.push(
      `mrrAt10 ${report.mrrAt10.toFixed(3)} < ${BASELINES.mrrAt10}`
    );
  }
  if (violations.length > 0) {
    // Print per-query details to make regressions debuggable.
    const lines = report.perQuery.map((q) => `  ${q.id}: recall=${q.recall.toFixed(2)} prec=${q.precision.toFixed(2)} mrr=${q.mrr.toFixed(2)} [${q.labels.join(',')}]`);
    throw new Error(
      `Benchmark regression: ${violations.join('; ')}\n` +
      `Per-query results:\n${lines.join('\n')}`
    );
  }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
