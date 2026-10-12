---
name: 05-onboarding
version: 0.1.0
source: hand-authored
status: draft
layer: workflows
maturity: experimental
role: core
entry_state: intake
exit_state: closed
allowed_states: [intake, plan, implement, review, verify, release, closed]
gates_used:
  - quality-gates/gates/06-skill-frontmatter.md
agents_used:
  - agents/core/doc-writer.md
  - agents/core/orchestrator.md
skills_used:
  - skills/core/teach/SKILL.md
  - skills/core/writing-for-agents/SKILL.md
  - skills/core/setup-matt-pocock-skills/SKILL.md
related_specs:
  - AGENTS.md
  - specs/0001-system-overview.md
---

# Workflow: Onboarding

For a new human or agent joining the project.

## Path

```
intake ─▶ plan ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ closed
                  (write / update onboarding doc)
```

## Transitions

| From         | To         | Skill(s)                              | Output                              |
|--------------|------------|---------------------------------------|-------------------------------------|
| intake       | plan       | teach                                 | Persona of the new joiner identified|
| plan         | implement  | writing-for-agents, teach             | Onboarding doc drafted              |
| implement    | review     | code-review                           | Doc reviewed for honesty            |
| review       | verify     | verification-before-completion        | Every link resolves                 |
| verify       | release    | —                                     | `docs/onboarding.md` updated        |
| release      | closed     | —                                     | Run recorded                        |

## Branching

* Onboarding a human → also add them to CODEOWNERS.
* Onboarding a new agent type → file an ADR; gate 05-agent-contract will
  block otherwise.
