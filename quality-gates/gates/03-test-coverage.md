# Gate 03 — Test coverage

* **Owner:** `agents/core/implementer.md`
* **Runner:** `pnpm gates:coverage`
* **Script:** `quality-gates/runners/coverage.mjs`
* **Fires on:** `pre-merge`, `CI`
* **Failure semantics:** blocks transitions `implement → review` and
  `review → verify`.

## Rule

Coverage is measured via `vitest --coverage` (v8) and must meet:

| Scope | Lines | Functions |
|---|---|---|
| `apps/api/src/auth/**` | ≥ 80 % | ≥ 80 % |
| `apps/api/src/**` | ≥ 60 % | — |

* Every new file under `apps/api/src/**` must include at least one unit test.
* Every bug-fix PR must add at least one **regression** test named
  `regression-<bug-id>.spec.ts`.

## How it runs

1. `pnpm --filter @mnemonics/api test:coverage` runs vitest with the JSON reporter.
2. `coverage.mjs` aggregates `coverage-final.json` per file and walks each
   target scope (`src/auth/` vs `src/`).
3. If a scope is below threshold, the gate prints `[coverage] FAIL` and
   exits non-zero.

Coverage is treated as a **gate**, not a goal. Adding code without tests
will fail this gate before review.

## Evidence

Coverage JSON lives in `apps/api/coverage/coverage-final.json` during the
run and is deleted before exit. The gate prints a per-scope line to stdout
on success.

## Remediation

1. Identify the file that dragged the metric below threshold.
2. Add unit tests targeting the uncovered branches.
3. If the threshold is unreachable for a file, open an ADR to lower it
   **for that file only**, with justification.
