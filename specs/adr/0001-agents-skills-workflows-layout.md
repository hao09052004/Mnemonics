# ADR-0001 — `agents/` + `skills/` + `workflows/` + `specs/` + `quality-gates/` layout

* **Status:** Accepted.
* **Date:** 2026-09-19.
* **Deciders:** orchestrator + planner (initial setup).

## Context

The repo is a pnpm monorepo for the Mnemonics product (`apps/{api,extension,web}`,
`packages/{ai,database,shared,ui}`). Five well-known reference repos were cloned
into `vendor/` to bring proven role, skill, and workflow patterns into the
project:

* `vendor/ponytail/` — anti-overengineering ruleset.
* `vendor/mattpocock-skills/` — engineering and productivity skills.
* `vendor/karpathy-skills/` — single guideline skill (`karpathy-guidelines`).
* `vendor/agency-agents/` — role library across many divisions.
* `vendor/superpowers/` — engineering skills + state machine + state-machine-like skills.

Without a coherent information architecture, these become dead weight or, worse,
inconsistent edits that drift from upstream.

## Decision

Adopt a **five-layer** layout at the repo root:

| Layer        | Folder           | Question                    |
|--------------|------------------|-----------------------------|
| **Who**      | `agents/`        | Who is acting?              |
| **How**      | `skills/`        | What capability?            |
| **When**     | `workflows/`     | In what order?              |
| **What**     | `specs/`         | What is the contract?       |
| **Good?**    | `quality-gates/` | Is it acceptable?           |

A **state machine** (`workflows/state-machine.md`) ties the layers together.
Every workflow is a path through the machine; every transition is gated.

Vendor content is **never** edited in place. Vendored skills in `skills/core/`
are byte-identical copies with a `skill.meta.yaml` sidecar declaring our
contract fields. Vendored agents, if used, live in `agents/curated/` with a
`source:` field.

The repo's *single* entry point is `AGENTS.md`, which any agent must read
**before** reading `skills/core/karpathy-guidelines/SKILL.md`. These two files
form the system-wide invariant of "operating principles" for every actor.

## Consequences

* **Pro:** single source of truth for roles, capabilities, contracts, and gates.
* **Pro:** vendor content is auditable via diff against `vendor/`.
* **Pro:** every transition has a name and a gate; lintable.
* **Con:** a second concept layer (sidecar `.skill.meta.yaml`) needs explaining.
* **Con:** we have to maintain the state machine as it evolves.

## Alternatives considered

1. **Drop everything into the apps.** Rejected — loses vendor content's value.
2. **Monolith of one folder.** Rejected — no clear ownership or contract.
3. **Use a tool like LangSmith.** Rejected — overkill for an MVP; we keep the
   option open later.

## Follow-ups

* ADR-0002: release-day policy (no Friday releases).
* ADR-0003: spec-sync CI runner (gate 07).
* ADR-0004: knowledge-regression golden set (gate 08).
