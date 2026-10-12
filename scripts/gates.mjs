#!/usr/bin/env node
/**
 * Quality-gates dispatcher.
 *
 * Runs the gate runners under quality-gates/runners/ in the canonical order
 * defined by `quality-gates/gates/01-style.md` … `08-knowledge-regression.md`.
 *
 * Each gate is a standalone Node script that exits 0 on PASS, 1 on FAIL.
 * This dispatcher just orchestrates them and stops on the first failure so
 * the CI logs are actionable.
 *
 * Usage:
 *   node scripts/gates.mjs                # run all 8 gates
 *   node scripts/gates.mjs agents         # run a single gate
 *   node scripts/gates.mjs skills spec-sync
 *
 * The "gate" names below match the per-gate scripts:
 *   agents, skills, spec-sync, coverage, knowledge-regression, typecheck
 *   (lint/style and security are shimmed to the bash runner `lint-all.sh`.)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const RUNNERS = join(REPO_ROOT, 'quality-gates', 'runners');

const isWindows = process.platform === 'win32';
const NODE = process.execPath;

/**
 * Map a gate name to the command that runs it.
 *
 * Typecheck is a special case: it is gate 02 per the gates/ spec, and the
 * authoritative runner is the `typecheck` script registered on the root
 * package.json (which recursively runs `tsc --noEmit` across workspaces).
 * We invoke that script via `pnpm` so it stays consistent with CI.
 */
const GATES = [
  { name: 'style',                 label: '01-style',                cmd: 'lint-all' },
  { name: 'typecheck',             label: '02-typecheck',            cmd: 'typecheck' },
  { name: 'coverage',              label: '03-test-coverage',        cmd: 'coverage' },
  { name: 'security',              label: '04-security',             cmd: 'lint-all', args: ['--security'] },
  { name: 'agents',                label: '05-agent-contract',       cmd: 'check-agents' },
  { name: 'skills',                label: '06-skill-frontmatter',    cmd: 'check-skills' },
  { name: 'spec-sync',             label: '07-spec-sync',            cmd: 'check-spec-sync' },
  { name: 'knowledge-regression',  label: '08-knowledge-regression', cmd: 'knowledge-regression' },
];

function runNode(runner, args = []) {
  const script = join(RUNNERS, `${runner}.mjs`);
  if (!existsSync(script)) {
    console.error(`[gates] FAIL — runner not found: ${script}`);
    return 1;
  }
  return spawnSync(NODE, [script, ...args], { stdio: 'inherit', cwd: REPO_ROOT }).status ?? 1;
}

function runPnpm(script, args = []) {
  // Use the local pnpm via `pnpm` so it picks up workspace config.
  // On Windows the `pnpm.cmd` shim only runs when invoked through a
  // shell, so we pass `shell: true`. The arguments are still passed
  // as an array, so there is no command-injection surface.
  const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
  return spawnSync(pnpm, [script, ...args], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    shell: isWindows,
  }).status ?? 1;
}

function runBash(script, args = []) {
  // lint-all.sh is the only shell-script gate; on Windows we delegate to
  // `bash` if it exists, otherwise skip with a warning (CI runs on Ubuntu).
  if (isWindows) {
    const bash = spawnSync('bash', ['--version'], { stdio: 'ignore' });
    if (bash.status !== 0) {
      console.warn(`[gates] SKIP ${script}.sh (bash not available on Windows; gate is run in CI)`);
      return 0;
    }
  }
  const sh = isWindows ? 'bash' : 'bash';
  return spawnSync(sh, [join(RUNNERS, `${script}.sh`), ...args], { stdio: 'inherit', cwd: REPO_ROOT }).status ?? 1;
}

function dispatch(gate) {
  switch (gate.cmd) {
    case 'lint-all':           return runBash(gate.cmd, gate.args ?? []);
    case 'typecheck':          return runPnpm('typecheck');
    case 'coverage':           return runNode('coverage');
    case 'check-agents':       return runNode('check-agents');
    case 'check-skills':       return runNode('check-skills');
    case 'check-spec-sync':    return runNode('check-spec-sync');
    case 'knowledge-regression': return runNode('knowledge-regression');
    default:
      console.error(`[gates] unknown runner command: ${gate.cmd}`);
      return 1;
  }
}

function main() {
  const requested = process.argv.slice(2);
  const selected = requested.length === 0
    ? GATES
    : GATES.filter((g) => requested.includes(g.name));

  if (selected.length === 0) {
    console.error(`[gates] no matching gate(s) for: ${requested.join(', ')}`);
    console.error(`[gates] available: ${GATES.map((g) => g.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`[gates] running ${selected.length} gate(s): ${selected.map((g) => g.label).join(', ')}`);
  const startedAt = Date.now();
  for (const gate of selected) {
    console.log(`\n[gates] === ${gate.label} ===`);
    const code = dispatch(gate);
    if (code !== 0) {
      console.error(`\n[gates] FAIL at ${gate.label} (exit=${code}) after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      process.exit(code);
    }
  }
  console.log(`\n[gates] ALL PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  process.exit(0);
}

main();
