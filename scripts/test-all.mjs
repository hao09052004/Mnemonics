#!/usr/bin/env node
/**
 * scripts/test-all.mjs
 *
 * Robust test runner for the Mnemonics monorepo.
 *
 * Why this exists
 * ---------------
 * `pnpm test` was a hand-written chain of `&&` commands. That worked most of
 * the time, but on Windows + Node 20 the API package occasionally crashed
 * with a non-zero exit code (4294967295 = -1) after the AI / database
 * packages had finished, leaving the developer with no useful diagnostic.
 *
 * This script:
 *   1. Runs every package's test command concurrently (max-3 in flight so we
 *      don't blow the laptop fan while still cutting wall-clock time).
 *   2. If a package exits non-zero OR with a Node-level crash signature
 *      (SIGSEGV / -1 / OOM), it retries the same package **once** before
 *      reporting a hard failure.
 *   3. Aggregates results and prints a single, greppable summary that
 *      matches the format the previous `&&` chain produced, so dashboards
 *      and CI logs that grep for "Test Files" keep working.
 *
 * Usage:
 *   node scripts/test-all.mjs           # run every package
 *   node scripts/test-all.mjs --keep    # run forever (we keep this!)
 *
 * Exit codes:
 *   0  all packages eventually passed
 *   1  one or more packages failed after the retry budget
 *   2  catastrophic — pnpm itself could not be invoked
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const PACKAGES = [
  '@mnemonics/shared',
  '@mnemonics/ai',
  '@mnemonics/database',
  '@mnemonics/api',
  '@mnemonics/extension-tests',
  '@mnemonics/web',
];

const MAX_CONCURRENCY = 3;
const RETRY_BUDGET = 1;

/** Heuristic: treat these exit signatures as transient and retry once. */
function isTransient(exitCode, signal) {
  if (signal) return true; // SIGTERM / SIGKILL / etc.
  if (exitCode === null) return true; // killed by parent
  // 4294967295 is the unsigned form of -1 — Node uses it for unhandled
  // crashes (V8 abort, native module segfault) on Windows.
  if (exitCode === 4294967295 || exitCode === -1) return true;
  return false;
}

function runPackage(pkg) {
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['--filter', pkg, 'test'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      stdout += s;
      process.stdout.write(`[${pkg}] ${s}`);
    });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      process.stderr.write(`[${pkg}] ${s}`);
    });

    child.on('close', (code, signal) => {
      resolve({ pkg, code, signal, stdout, stderr });
    });
  });
}

async function runWithRetry(pkg) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const result = await runPackage(pkg);
    const ok = result.code === 0;
    if (ok) {
      return { ...result, attempts: attempt, finalStatus: 'pass' };
    }
    if (attempt > RETRY_BUDGET || !isTransient(result.code, result.signal)) {
      return { ...result, attempts: attempt, finalStatus: 'fail' };
    }
    console.warn(`[runner] ${pkg} crashed (code=${result.code} signal=${result.signal}); retrying (${attempt}/${RETRY_BUDGET})`);
  }
}

/** Minimal async pool — runs at most `n` workers at once. */
async function runAll(tasks, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`[runner] starting ${PACKAGES.length} test packages (concurrency=${MAX_CONCURRENCY}, retries=${RETRY_BUDGET})`);
  const startedAt = Date.now();

  const tasks = PACKAGES.map((pkg) => () => runWithRetry(pkg));
  const results = await runAll(tasks, MAX_CONCURRENCY);

  const failed = results.filter((r) => r.finalStatus !== 'pass');
  const passed = results.filter((r) => r.finalStatus === 'pass');

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('========================================');
  console.log(`[runner] finished — passed=${passed.length} failed=${failed.length} elapsed=${elapsed}s`);
  for (const r of results) {
    const tag = r.finalStatus === 'pass' ? 'OK ' : 'FAIL';
    console.log(`  [${tag}] ${r.pkg}  attempts=${r.attempts}  code=${r.code}  signal=${r.signal ?? '-'}`);
  }
  console.log('========================================');

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[runner] catastrophic failure', err);
  process.exit(2);
});