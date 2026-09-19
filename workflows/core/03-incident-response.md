---
name: 03-incident-response
version: 0.1.0
source: hand-authored
status: stable
layer: workflows
maturity: experimental
role: core
entry_state: incident
exit_state: closed
allowed_states: [intake, incident, implement, review, verify, release, closed]
gates_used:
  - quality-gates/gates/02-typecheck.md
  - quality-gates/gates/04-security.md
agents_used:
  - agents/core/orchestrator.md
  - agents/core/incident-responder.md
  - agents/core/code-reviewer.md
skills_used:
  - skills/core/systematic-debugging/SKILL.md
  - skills/core/karpathy-guidelines/SKILL.md
related_specs:
  - specs/0001-system-overview.md
---

# Workflow: Incident response

## Path

```
intake ─▶ incident ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ closed
                                  (mitigation, not rewrite)
```

## Transitions

| From         | To         | Skill(s)                          | Gates                              |
|--------------|------------|-----------------------------------|------------------------------------|
| intake       | incident   | systematic-debugging              | —                                  |
| incident     | implement  | karpathy-guidelines               | 02-typecheck                       |
| implement    | review     | verification-before-completion    | 02-typecheck                       |
| review       | verify     | code-review                       | 04-security                        |
| verify       | release    | verification-before-completion    | 04-security                        |
| release      | closed     | receiving-code-review             | — (post-mortem required)           |

## Required artefacts

1. `docs/post-mortems/YYYY-MM-DD-<slug>.md` — before `closed`.
2. Mitigation PR must be **minimal** — no refactor.
3. Long-term fix, if any, goes through `workflows/core/01-feature-development.md`
   as a separate item.

## Branching

* Sev-1 → page on-call within 5 min, lead is `incident-responder`.
