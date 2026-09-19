---
name: workflow-slug
version: 0.1.0
source: hand-authored
status: draft
layer: workflows
maturity: experimental
role: core | product
entry_state: intake
exit_state: closed
allowed_states: [intake, plan, implement, review, verify, release, closed]
gates_used:
  - quality-gates/gates/01-style.md
agents_used:
  - agents/core/orchestrator.md
skills_used:
  - skills/core/brainstorming/SKILL.md
related_specs:
  - specs/0001-system-overview.md
---

# Workflow: {{Title Case Name}}

## Purpose

When does this workflow run? One paragraph.

## Path through the state machine

```
[intake] ─▶ plan ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ [closed]
```

## States, agents, and gates per transition

### intake → plan

* **Skill:** `skills/core/brainstorming/SKILL.md`.
* **Gate:** `quality-gates/gates/05-agent-contract.md` (orchestrator must declare
  its inputs).
* **Exit criteria:** A one-paragraph problem statement + first-cut plan.

### plan → implement

* **Skill:** `skills/core/writing-plans/SKILL.md`.
* **Gate:** plan must reference specs.

### implement → review

* **Skill:** `skills/core/test-driven-development/SKILL.md`.
* **Gates:** 01-style, 02-typecheck, 03-test-coverage, 07-spec-sync.

### review → verify

* **Agent:** `agents/core/code-reviewer.md`.
* **Skill:** `skills/core/code-review/SKILL.md`.

### verify → release

* **Gates:** 04-security, 08-knowledge-regression (if applicable).

### release → closed

* **Required artefact:** `workflows/runs/<date>-<slug>.md`.

## Branching

* If a sev-1/2 hits during any state → enter `incident` workflow.

## Related

* Specs:
* ADRs:
* Other workflows:
