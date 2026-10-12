---
name: 02-bug-investigation
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
  - quality-gates/gates/02-typecheck.md
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/07-spec-sync.md
agents_used:
  - agents/core/orchestrator.md
  - agents/core/implementer.md
  - agents/core/code-reviewer.md
skills_used:
  - skills/core/systematic-debugging/SKILL.md
  - skills/core/diagnosing-bugs/SKILL.md
  - skills/core/test-driven-development/SKILL.md
  - skills/core/karpathy-guidelines/SKILL.md
related_specs:
  - specs/0001-system-overview.md
---

# Workflow: Bug investigation

## Path

```
intake ─▶ plan ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ closed
```

## Transitions

| From         | To         | Skill(s)                                       | Gates                                            |
|--------------|------------|------------------------------------------------|--------------------------------------------------|
| intake       | plan       | systematic-debugging, diagnosing-bugs          | 05-agent-contract                                |
| plan         | implement  | karpathy-guidelines, test-driven-development   | 07-spec-sync                                     |
| implement    | review     | test-driven-development                        | 02-typecheck, 03-test-coverage                  |
| review       | verify     | code-review                                    | 03-test-coverage                                 |
| verify       | release    | verification-before-completion                 | 04-security                                      |
| release      | closed     | finishing-a-development-branch                 | —                                                |

## Branching

* Bug recurs within 14 days → enter `incident` workflow.

## Required artefact

Every bug fix ships with **one regression test** named after the bug. The
test is part of the `implement → review` exit criteria.
