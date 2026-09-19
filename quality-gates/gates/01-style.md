# Gate 01 — Style

* **Owner:** `agents/core/code-reviewer.md`
* **Runner:** `../runners/lint-all.sh`
* **Fires on:** `pre-edit`, `pre-commit`, `pre-merge`, `CI`
* **Failure semantics:** blocks transitions `implement → review` and
  `review → verify`.

## Rule

Code under `apps/` and `packages/` must pass the project linters:

* TypeScript: ESLint with `eslint-config-mnemonics` (extends `eslint:recommended`,
  `@typescript-eslint/recommended-type-checked`).
* Python (workers): `ruff check` + `ruff format --check`.
* Markdown (specs and skills): `markdownlint` with our config.

## Evidence

The runner prints the first 50 lines of each linter output and writes the full
log to `quality-gates/.logs/01-style-<date>.log`.

## Remediation

1. Run `pnpm lint --fix` for the failing package.
2. For markdown: `pnpm md:fix`.
3. Re-run the runner.
