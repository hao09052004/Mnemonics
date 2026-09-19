# `specs/` — *What* the contract is

A **spec** is the single source of truth for an interface. Code that
contradicts a spec is a bug. A spec that contradicts reality is unmaintained.

Both should fail CI.

## Folder layout

| Folder        | Purpose                                                                |
|---------------|------------------------------------------------------------------------|
| `0001-…`      | System-level specs (architecture, contracts, state machine).            |
| `api/`        | REST/Edge-function contracts, one file per endpoint family.            |
| `data/`       | Database schemas, vector configs, knowledge-graph schema.              |
| `adr/`        | Architecture Decision Records (`NNNN-kebab-case.md`).                  |
| `plans/`      | Phased implementation plans authored by `agents/core/planner.md`.      |
| `runs/`       | Optional — copies of `workflows/runs/` indexed by spec.                |

## Numbering

* System specs are numbered `NNNN-kebab-case.md`. They are sequential and
  ordered by importance:
  * `0001-system-overview.md` — read first.
  * `0002-agent-contract.md` — defines frontmatter for agents.
  * `0003-skill-contract.md` — defines frontmatter for SKILL.md.
  * `0004-workflow-state-machine.md` — auto-generated mirror of
    `../workflows/state-machine.md`.
* API specs are unnumbered but follow `<endpoint-family>.md`.
* Data specs follow `<topic>.md`.
* ADRs are numbered sequentially as decisions accumulate.

## Contract discipline

1. **One source of truth.** A field name appears in exactly one place. If you
   see the same field in two specs, one of them is wrong.
2. **No code in a spec.** Specs describe interfaces; pseudocode in specs is
   allowed only for ASCII art (e.g., the state machine diagram).
3. **Bumps require ADRs.** Any breaking change to a numbered spec must be
   accompanied by an ADR that explains the migration path.

## Read order for a new agent

1. `0001-system-overview.md`
2. `0002-agent-contract.md` (so you know how your own role is structured)
3. `0003-skill-contract.md` (so you know how to invoke skills)
4. The relevant `api/` and `data/` specs for the area you're touching.
