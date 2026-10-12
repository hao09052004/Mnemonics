---
name: 01-feature-development
version: 0.1.0
source: hand-authored
status: stable
layer: workflows
maturity: experimental
role: core
entry_state: intake
exit_state: closed
allowed_states: [intake, plan, implement, review, verify, release, closed]
gates_used:
  - quality-gates/gates/01-style.md
  - quality-gates/gates/02-typecheck.md
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/04-security.md
  - quality-gates/gates/05-agent-contract.md
  - quality-gates/gates/07-spec-sync.md
agents_used:
  - agents/core/orchestrator.md
  - agents/core/planner.md
  - agents/core/implementer.md
  - agents/core/code-reviewer.md
  - agents/core/security-reviewer.md
  - agents/core/doc-writer.md
skills_used:
  - skills/core/brainstorming/SKILL.md
  - skills/core/writing-plans/SKILL.md
  - skills/core/test-driven-development/SKILL.md
  - skills/core/code-review/SKILL.md
  - skills/core/karpathy-guidelines/SKILL.md
related_specs:
  - specs/0001-system-overview.md
  - specs/0004-workflow-state-machine.md
---

# Workflow: Feature development

The canonical path for shipping a new Mnemonics feature, end-to-end.

## Path

```
intake ─▶ plan ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ closed
```

## Transitions

| From         | To         | Skill(s)                              | Gates                                                    | Agent                |
|--------------|------------|---------------------------------------|----------------------------------------------------------|----------------------|
| intake       | plan       | brainstorming                         | 05-agent-contract                                        | orchestrator, planner |
| plan         | implement  | writing-plans, karpathy-guidelines    | 07-spec-sync                                             | planner, implementer |
| implement    | review     | test-driven-development, implement    | 01-style, 02-typecheck, 03-test-coverage, 07-spec-sync    | implementer          |
| review       | verify     | code-review, reducing-complexity      | 03-test-coverage                                         | code-reviewer (+security-reviewer if sensitive) |
| verify       | release    | verification-before-completion        | 04-security, 08-knowledge-regression                     | orchestrator         |
| release      | closed     | finishing-a-development-branch        | —                                                        | orchestrator         |

## Branching

* Sensitive surface area (auth, RLS, secrets, network egress) →
  `agents/core/security-reviewer.md` is mandatory in `review`.
* New embedding model → ADR + `08-knowledge-regression.md` golden-set rerun.

## Related

* [`workflows/product/capture-to-knowledge.md`](../product/capture-to-knowledge.md) —
  product-specific application of this workflow.
* [`workflows/state-machine.md`](../state-machine.md) — for invariants.
