# State Machine

> Canonical. Do not edit casually. Changes require an ADR under
> [`../specs/adr/`](../specs/adr).

This is the *finite* state machine every workflow in this repo is a path
through. There are exactly **eight** states and **seven** transitions. Workflows
narrow the vocabulary; they never extend it.

## States

| State      | Purpose                                                            |
|------------|--------------------------------------------------------------------|
| `intake`   | Request received, scope unclear.                                   |
| `plan`     | Plan approved, no code yet.                                        |
| `implement`| Code + tests being written.                                        |
| `review`   | Human or AI review in progress.                                    |
| `verify`   | Quality gates running; nothing is being changed.                  |
| `release`  | Tagged, deployed, smoke-tested.                                    |
| `closed`   | Run complete; record archived under `workflows/runs/`.             |
| `incident` | Side-track for outages; returns to last stable state on resolution.|

## Transitions

```
                   gate: 01-style
        intake ─────────────────────▶ plan
          │                             │
          │ skills/core/brainstorming   │ skills/core/writing-plans
          │                             ▼
          │                          implement
          │                             │
          │                gates: 01-style, 02-typecheck, 03-test-coverage
          │                             ▼
          │                          review
          │                             │
          │                  skills/core/code-review
          │                             ▼
          │                          verify
          │                             │
          │              gates: 04-security, 07-spec-sync, 08-knowledge-regression
          │                             ▼
          │                          release
          │                             │
          │                             ▼
          └────────────────────────▶  closed
                                            ▲
                                            │
                            incident ──────┘  (post-mortem required)
                              ▲
                              │ any state → incident if sev-1/2
```

## Gate vocabulary

The transitions above reference gates by name. The canonical list is in
[`../quality-gates/gates/`](../quality-gates/gates). Every workflow that
crosses a transition MUST cite the gate it depends on.

## Agent vocabulary

| State       | Default agent                          |
|-------------|-----------------------------------------|
| `intake`    | `agents/core/orchestrator.md`           |
| `plan`      | `agents/core/planner.md`                |
| `implement` | `agents/core/implementer.md`            |
| `review`    | `agents/core/code-reviewer.md` (+security-reviewer for sensitive paths) |
| `verify`    | `agents/core/orchestrator.md`           |
| `release`   | `agents/core/orchestrator.md`           |
| `incident`  | `agents/core/incident-responder.md`     |

## Invariants

1. `release → closed` requires a `workflows/runs/<date>-<slug>.md`.
2. `incident → <previous>` requires a post-mortem in `docs/post-mortems/`.
3. A workflow can only enter `release` if its entry state was `verify` (i.e.
   no skipping).
4. No transition without at least one gate. (Even `intake → plan` requires
   `01-style` and `05-agent-contract.md` to have been respected during intake.)
