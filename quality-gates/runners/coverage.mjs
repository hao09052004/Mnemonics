#!/usr/bin/env node
/**
 * Coverage gate runner.
 *
 * Runs `pnpm --filter @mnemonics/api test -- --coverage` and enforces:
 *   - 80 % lines on `src/auth/**`
 *   - 60 % lines on `src/**` overall
 *   - 80 % functions on `src/auth/**`
 *
 * Writes a summary to stdout and exits non-zero on regression.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PATH_PREFIX = 'apps/api/src';

const isWindows = process.platform === 'win32';
const cmd = isWindows ? 'cmd.exe' : 'pnpm';
const args = isWindows
  ? ['/c', 'pnpm', '--filter', '@mnemonics/api', 'test:coverage']
  : ['--filter', '@mnemonics/api', 'test:coverage'];

const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

if (result.status !== 0) {
  console.error('[coverage] FAIL — vitest run did not pass.');
  process.exit(result.status ?? 1);
}

const summaryPath = join(ROOT, 'apps/api/coverage/coverage-final.json');
let summary;
try {
  const raw = JSON.parse(readFileSync(summaryPath, 'utf8'));
  // v8 json reporter emits `{ [filepath]: { lines, branches, functions, statements } }`.
  summary = {};
  for (const [file, entry] of Object.entries(raw)) {
    if (file === 'total') continue;
    summary[file] = {
      lines: { pct: entry.lines?.pct ?? 0, covered: entry.lines?.covered ?? 0, total: entry.lines?.total ?? 0 },
      functions: { pct: entry.functions?.pct ?? 0, covered: entry.functions?.covered ?? 0, total: entry.functions?.total ?? 0 }
    };
  }
} catch (e) {
  console.error('[coverage] FAIL — could not read', summaryPath);
  console.error(e?.message);
  process.exit(1);
}
rmSync(join(ROOT, 'apps/api/coverage'), { recursive: true, force: true });

const TARGETS = {
  lines: { 'src/auth/': 0.80, 'src/': 0.60 },
  functions: { 'src/auth/': 0.80 }
};

const errors = [];
for (const [metric, map] of Object.entries(TARGETS)) {
  for (const [dir, threshold] of Object.entries(map)) {
    let covered = 0;
    let total = 0;
    for (const [file, value] of Object.entries(summary)) {
      if (!file.includes(PATH_PREFIX) || !file.includes(dir)) continue;
      const v = value?.[metric];
      if (!v) continue;
      covered += v.covered ?? 0;
      total += v.total ?? 0;
    }
    const pct = total === 0 ? 100 : (covered / total) * 100;
    if (pct < threshold * 100) {
      errors.push(`  - ${metric} on ${dir}: ${pct.toFixed(2)}% < ${threshold * 100}%`);
    } else {
      console.log(`[coverage] ${metric} on ${dir}: ${pct.toFixed(2)}% (>= ${threshold * 100}%)`);
    }
  }
}

if (errors.length) {
  console.error('[coverage] FAIL');
  for (const e of errors) console.error(e);
  process.exit(1);
}

console.log('[coverage] PASS');
