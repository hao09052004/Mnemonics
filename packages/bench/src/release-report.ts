/**
 * M4 — release-readiness report generator.
 *
 * Renders the benchmark numbers, E2E results, test counts,
 * ranking weights, migrations, and Free Tier verification
 * into one markdown string the operator can paste into the
 * release PR.
 */
import type { BenchmarkReport } from './benchmark.js';
import type { ClassifierF1Report } from './classifier-harness.js';

export interface E2EResult {
  id: string;            // "A".."H"
  name: string;
  passed: boolean;
  durationMs?: number;
  notes?: string;
}

export interface ReleaseReportInput {
  benchmark: BenchmarkReport;
  classifier: ClassifierF1Report;
  e2e: E2EResult[];
  testCounts: Record<string, number>;
  rankingWeights: { lex: number; sem: number; struct: number; rrfK: number };
  migrations: string[];
  freeTier: { aiFreeOnly: boolean; provider: string };
}

export interface ReleaseReportOptions {
  /** Build identifier (commit SHA, branch, etc.). */
  buildId?: string;
  /** ISO timestamp; defaults to "now". */
  generatedAt?: string;
}

export function generateReleaseReport(
  input: ReleaseReportInput,
  options: ReleaseReportOptions = {}
): string {
  const now = options.generatedAt ?? new Date().toISOString();
  const build = options.buildId ?? 'local';

  const benchSection = renderBenchmark(input.benchmark);
  const f1Section = renderClassifier(input.classifier);
  const e2eSection = renderE2E(input.e2e);
  const testSection = renderTestCounts(input.testCounts);
  const weightsSection = renderWeights(input.rankingWeights);
  const migrationsSection = renderMigrations(input.migrations);
  const freeTierSection = renderFreeTier(input.freeTier);

  return [
    `# Core Experience — Release Readiness Report`,
    ``,
    `- Generated: ${now}`,
    `- Build: \`${build}\``,
    ``,
    `## 1. Search Relevance Benchmark`,
    benchSection,
    ``,
    `## 2. Classifier F1`,
    f1Section,
    ``,
    `## 3. E2E Acceptance (Tests A–H)`,
    e2eSection,
    ``,
    `## 4. Per-package Test Counts`,
    testSection,
    ``,
    `## 5. Ranking Weights (pinned)`,
    weightsSection,
    ``,
    `## 6. Database Migrations Applied`,
    migrationsSection,
    ``,
    `## 7. Free Tier Verification`,
    freeTierSection
  ].join('\n');
}

function renderBenchmark(b: BenchmarkReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return [
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Queries scored | ${b.total} |`,
    `| Recall@5 | ${pct(b.recallAt5)} |`,
    `| Precision@5 | ${pct(b.precisionAt5)} |`,
    `| MRR@10 | ${pct(b.mrrAt10)} |`,
    `| Lex candidates | ${b.legCounts.lex} |`,
    `| Semantic candidates | ${b.legCounts.sem} |`,
    `| Structured candidates | ${b.legCounts.struct} |`,
    `| Chunk candidates | ${b.legCounts.chunk} |`
  ].join('\n');
}

function renderClassifier(c: ClassifierF1Report): string {
  const lines = [
    `| Class | F1 |`,
    `|-------|----|`,
    ...Object.entries(c.perClass).map(([k, v]) => `| ${k} | ${v.toFixed(2)} |`),
    ``,
    `Macro F1: **${c.f1.toFixed(2)}** (n=${c.total})`
  ];
  if (c.mismatches.length > 0) {
    lines.push(``, `Mismatches: ${c.mismatches.length}`);
  }
  return lines.join('\n');
}

function renderE2E(e2e: E2EResult[]): string {
  return [
    `| ID | Test | Status | Duration |`,
    `|----|------|--------|----------|`,
    ...e2e.map((r) => {
      const status = r.passed ? '✅ pass' : '❌ fail';
      const dur = r.durationMs ? `${r.durationMs}ms` : '—';
      return `| ${r.id} | ${r.name} | ${status} | ${dur} |`;
    })
  ].join('\n');
}

function renderTestCounts(counts: Record<string, number>): string {
  return [
    `| Package | Tests |`,
    `|---------|-------|`,
    ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`)
  ].join('\n');
}

function renderWeights(w: { lex: number; sem: number; struct: number; rrfK: number }): string {
  return [
    `| Weight | Value |`,
    `|--------|-------|`,
    `| lex | ${w.lex} |`,
    `| sem | ${w.sem} |`,
    `| struct | ${w.struct} |`,
    `| rrf_k | ${w.rrfK} |`
  ].join('\n');
}

function renderMigrations(migrations: string[]): string {
  return migrations.map((m) => `- \`${m}\``).join('\n');
}

function renderFreeTier(f: { aiFreeOnly: boolean; provider: string }): string {
  return [
    `- AI_FREE_ONLY = \`${f.aiFreeOnly}\``,
    `- Embedding provider = \`${f.provider}\``
  ].join('\n');
}
