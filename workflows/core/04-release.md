---
name: 04-release
version: 0.1.0
source: hand-authored
status: stable
layer: workflows
maturity: experimental
role: core
entry_state: verify
exit_state: closed
allowed_states: [verify, release, closed]
gates_used:
  - quality-gates/gates/01-style.md
  - quality-gates/gates/02-typecheck.md
  - quality-gates/gates/03-test-coverage.md
  - quality-gates/gates/04-security.md
  - quality-gates/gates/08-knowledge-regression.md
agents_used:
  - agents/core/orchestrator.md
  - agents/core/code-reviewer.md
skills_used:
  - skills/core/verification-before-completion/SKILL.md
  - skills/core/finishing-a-development-branch/SKILL.md
related_specs:
  - specs/0001-system-overview.md
---

# Workflow: Release

Used to tag, deploy, and smoke-test a release candidate. Entry state is `verify`,
not `intake` — release is a *final* step, never the first one.

## Path

```
verify ─▶ release ─▶ closed
```

## Transitions

| From     | To      | Skill(s)                                  | Gates                                                       |
|----------|---------|-------------------------------------------|-------------------------------------------------------------|
| verify   | release | verification-before-completion            | 01-style, 02-typecheck, 03-test-coverage, 04-security, 08-knowledge-regression |
| release  | closed  | finishing-a-development-branch            | — (smoke-test must pass)                                    |

## Required artefacts

1. Tag in git (`vX.Y.Z`).
2. CHANGELOG entry.
3. `workflows/runs/YYYY-MM-DD-release-vX.Y.Z.md` recording every gate result.

## Anti-patterns

* Releasing on a Friday. (Yes, this is policy. ADR-0002.)
