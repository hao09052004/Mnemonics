/**
 * Benchmark integration test (M4).
 *
 * Skips when no real DATABASE_URL is available.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool } from '@mnemonics/database';
import type { Pool } from 'pg';
import { loadDataset } from '../dataset.js';
import { seedBenchmarkDataset, cleanupBenchmarkDataset } from '../seeder.js';
import { runBenchmark } from '../benchmark.js';
import { runClassifierF1 } from '../classifier-harness.js';
import { generateReleaseReport } from '../release-report.js';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

describe.skipIf(skipIfNoDb)('M4 benchmark', () => {
  let pool: Pool;
  let seeder: Awaited<ReturnType<typeof seedBenchmarkDataset>>;

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    seeder = await seedBenchmarkDataset(pool, loadDataset());
  });

  afterEach(async () => {
    if (seeder) {
      await cleanupBenchmarkDataset(pool, seeder);
    }
    await pool.end();
  });

  it('recall@5, precision@5, mrr@10 meet the M4 baselines', async () => {
    const dataset = loadDataset();
    const report = await runBenchmark({ pool, seeder, dataset });
    expect(report.total).toBe(30);
    expect(report.recallAt5).toBeGreaterThanOrEqual(0.5);
    expect(report.precisionAt5).toBeGreaterThanOrEqual(0.5);
    expect(report.mrrAt10).toBeGreaterThanOrEqual(0.4);
  });

  it('classifier F1 is 1.0 because the seeder writes the ground truth', async () => {
    const dataset = loadDataset();
    const f1 = await runClassifierF1(pool, dataset, seeder);
    expect(f1.f1).toBe(1.0);
    expect(f1.mismatches).toHaveLength(0);
  });

  it('structured leg contributes to at least one query', async () => {
    const dataset = loadDataset();
    const report = await runBenchmark({ pool, seeder, dataset });
    expect(report.legCounts.struct).toBeGreaterThan(0);
  });

  it('release report includes all 7 sections', () => {
    const md = generateReleaseReport({
      benchmark: {
        total: 30,
        topK: 5,
        recallAt5: 0.6,
        precisionAt5: 0.6,
        mrrAt10: 0.5,
        perQuery: [],
        legCounts: { lex: 100, sem: 0, struct: 30, chunk: 0 }
      },
      classifier: { total: 60, f1: 1.0, perClass: { product: 1 }, mismatches: [] },
      e2e: [
        { id: 'A', name: 'capture+classify', passed: true, durationMs: 120 },
        { id: 'B', name: 'detected chip', passed: true, durationMs: 50 },
        { id: 'H', name: 'user-attribute override', passed: true, durationMs: 80 }
      ],
      testCounts: { database: 100, ai: 50, api: 311, web: 200, bench: 10 },
      rankingWeights: { lex: 0.4, sem: 0.6, struct: 0.5, rrfK: 60 },
      migrations: ['025_item_classifications', '026_items_source_metadata'],
      freeTier: { aiFreeOnly: true, provider: 'gemini-3.5-flash-lite' }
    });
    expect(md).toContain('## 1. Search Relevance Benchmark');
    expect(md).toContain('## 2. Classifier F1');
    expect(md).toContain('## 3. E2E Acceptance (Tests A–H)');
    expect(md).toContain('## 4. Per-package Test Counts');
    expect(md).toContain('## 5. Ranking Weights (pinned)');
    expect(md).toContain('## 6. Database Migrations Applied');
    expect(md).toContain('## 7. Free Tier Verification');
    expect(md).toContain('0.5');
    expect(md).toContain('0.6');
  });
});
