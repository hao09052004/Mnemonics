# `workflows/` — *When* and *in what order*

A **workflow** is a path through the canonical state machine. Workflows are the
only place in this repo where *time* is represented — every other layer is
timeless documentation.

## The state machine

The single source of truth for transitions is
[`state-machine.md`](state-machine.md). Every workflow declares:

* Its **entry state**.
* Its **exit state**.
* The **allowed transitions** (subset of the state machine's vocabulary).
* The **gates** that fire on each transition.
* The **agents** and **skills** that fire on each state.

## Folder layout

| Folder          | Purpose                                                           |
|-----------------|-------------------------------------------------------------------|
| `_templates/`   | `workflow.template.md` and `state-machine.template.md`.          |
| `core/`         | Engineering workflows: feature dev, bug, incident, release, etc.  |
| `product/`      | Mnemonics product workflows: capture → knowledge, search query.   |
| `runs/`         | Records of past runs (one markdown file per run).                 |

## How to read a workflow

Take `core/01-feature-development.md`. Its structure is:

```
[entry] ─▶ intake ─┬─▶ plan ─▶ implement ─▶ review ─▶ verify ─▶ release ─▶ [exit]
                    │           │             │         │          │
                    │           │             │         │          └─ quality-gates/gates/03-test-coverage.md
                    │           │             │         └─ quality-gates/gates/08-knowledge-regression.md
                    │           │             └─ skills/core/code-review
                    │           └─ skills/core/test-driven-development
                    └─ skills/core/brainstorming
```

If a workflow needs to deviate from `state-machine.md`, write an ADR. Do not edit
the workflow file in isolation.

## Run records

When you run a workflow, drop a `runs/YYYY-MM-DD-<slug>.md` capturing:

* Entry state, exit state.
* Every gate outcome (PASS/FAIL with link to evidence).
* Every spec/skill/agent touched.
* Post-mortem if anything went off-rails.

`runs/` is the audit trail; never delete from it.
