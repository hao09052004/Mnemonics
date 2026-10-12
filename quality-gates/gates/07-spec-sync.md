# Gate 07 — Spec sync

* **Owner:** `agents/core/code-reviewer.md`
* **Runner:** `../runners/check-spec-sync.mjs`
* **Fires on:** any change under `specs/`, `apps/`, or `packages/`
* **Failure semantics:** blocks transitions `implement → review`.

## Rule

* Every path referenced in `agents/**.md` (`inputs/outputs/skills/gates`) must
  resolve.
* Every state transition declared in any `workflows/**/*.md` must be a subset
  of the canonical state machine in
  [`../../specs/0004-workflow-state-machine.md`](../../specs/0004-workflow-state-machine.md).
* Every type exported by `packages/shared` and referenced from a spec must
  exist.

## Evidence

`quality-gates/.logs/07-spec-sync-<date>.log`.

## Remediation

1. If a spec drifted from code, fix the code; the spec wins.
2. If a workflow uses a non-existent transition, either fix the workflow or
   open an ADR to add the transition to the state machine.
