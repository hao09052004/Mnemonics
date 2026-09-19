# Gate 03 — Test coverage

* **Owner:** `agents/core/implementer.md`
* **Runner:** `pnpm --recursive test` + `c8`
* **Fires on:** `pre-merge`, `CI`
* **Failure semantics:** blocks transitions `implement → review` and
  `review → verify`.

## Rule

* Every package must reach the coverage thresholds declared in
  `packages/*/vitest.config.ts` (default: lines 80 %, branches 70 %).
* Every new file under `apps/api/**` must include at least one unit test.
* Every bug-fix PR must add at least one **regression** test named
  `regression-<bug-id>.spec.ts`.

## Evidence

Coverage JSON is stored under `quality-gates/.coverage/<date>/<package>.json`.

## Remediation

1. Identify the package whose coverage dropped.
2. Add unit tests for the affected module.
3. If the threshold is unreachable, open an ADR to lower it **for that
   package only**, with justification.
