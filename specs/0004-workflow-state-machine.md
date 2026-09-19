# Spec 0004 — Workflow state machine

> This file is the textual mirror of [`../workflows/state-machine.md`](../workflows/state-machine.md).
> It is the **machine-readable** form used by gate
> [`../quality-gates/gates/07-spec-sync.md`](../quality-gates/gates/07-spec-sync.md)
> to validate that workflows are subsets of the canonical state machine.

## 1. States

```yaml
states:
  - id: intake
    default_agent: agents/core/orchestrator.md
  - id: plan
    default_agent: agents/core/planner.md
  - id: implement
    default_agent: agents/core/implementer.md
  - id: review
    default_agent: agents/core/code-reviewer.md
  - id: verify
    default_agent: agents/core/orchestrator.md
  - id: release
    default_agent: agents/core/orchestrator.md
  - id: incident
    default_agent: agents/core/incident-responder.md
  - id: closed
    default_agent: null
```

## 2. Transitions

```yaml
transitions:
  - from: intake
    to: plan
    gates: [quality-gates/gates/05-agent-contract.md]
    skills: [skills/core/brainstorming/SKILL.md]
  - from: plan
    to: implement
    gates: [quality-gates/gates/07-spec-sync.md]
    skills: [skills/core/writing-plans/SKILL.md, skills/core/karpathy-guidelines/SKILL.md]
  - from: implement
    to: review
    gates:
      - quality-gates/gates/01-style.md
      - quality-gates/gates/02-typecheck.md
      - quality-gates/gates/03-test-coverage.md
      - quality-gates/gates/07-spec-sync.md
    skills:
      - skills/core/test-driven-development/SKILL.md
      - skills/core/implement/SKILL.md
  - from: review
    to: verify
    gates: [quality-gates/gates/03-test-coverage.md]
    skills: [skills/core/code-review/SKILL.md, skills/core/reducing-complexity/SKILL.md]
  - from: verify
    to: release
    gates:
      - quality-gates/gates/04-security.md
      - quality-gates/gates/07-spec-sync.md
      - quality-gates/gates/08-knowledge-regression.md
    skills: [skills/core/verification-before-completion/SKILL.md]
  - from: release
    to: closed
    gates: []
    skills: [skills/core/finishing-a-development-branch/SKILL.md]
  - from: any
    to: incident
    gates: []
    skills: [skills/core/systematic-debugging/SKILL.md]
  - from: incident
    to: last_stable
    gates:
      - quality-gates/gates/02-typecheck.md
      - quality-gates/gates/04-security.md
    skills: [skills/core/systematic-debugging/SKILL.md]
```

## 3. Invariants

1. Every `transitions[].gates` must reference a real gate file.
2. Every `transitions[].skills` must reference a real SKILL.md file.
3. A workflow may only use a subset of the states and transitions above.
4. No new transition may be introduced without an ADR.
