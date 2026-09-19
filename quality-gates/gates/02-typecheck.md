# Gate 02 — Typecheck

* **Owner:** `agents/core/implementer.md`
* **Runner:** `pnpm --recursive typecheck`
* **Fires on:** `pre-commit`, `CI`
* **Failure semantics:** blocks transitions `implement → review`.

## Rule

`tsc --noEmit` must exit 0 across every workspace package.

## Evidence

Full `tsc` output is captured by `pnpm`.

## Remediation

1. Read the first error.
2. Fix the root cause; do not silence with `// @ts-expect-error` unless
   accompanied by a code comment justifying it.
3. Re-run.
