# AGENTS.md — Mnemonics Project Rulebook

> **Read this first.** This file is the single entry point for any human or AI agent
> operating in this repository. It defines the *information architecture* under which
> every other agent, skill, workflow, and quality gate lives.

This project is **Mnemonics** — a personal-knowledge-management SaaS ("Second Brain"):
browser-extension capture → API → OCR + auto-tagging + embeddings → Web dashboard
with keyword and semantic search. The full product specification lives in
[`README.md`](README.md) and the authoritative architecture lives in
[`specs/0001-system-overview.md`](specs/0001-system-overview.md).

---

## 1. The five-layer information architecture

All artefacts in this repo live in exactly one of five layers. Knowing which layer a
question belongs to is half of answering it.

| Layer        | Folder             | Question it answers        | Owned by                |
|--------------|--------------------|----------------------------|-------------------------|
| **Who**      | `agents/`          | "Who is acting?"           | `agents/README.md`      |
| **How**      | `skills/`          | "What capability is used?" | `skills/README.md`      |
| **When**     | `workflows/`       | "In what order?"           | `workflows/README.md`   |
| **What**     | `specs/`           | "What is the contract?"    | `specs/README.md`       |
| **Good?**    | `quality-gates/`   | "Is it acceptable?"        | `quality-gates/README.md` |

A **state machine** (defined in `workflows/state-machine.md`) ties the layers together:
every workflow moves through `intake → plan → implement → review → verify → release`,
and at each transition a **quality gate** must pass before the next state is entered.

```
            ┌──────────┐  gate-1   ┌──────────┐  gate-2   ┌──────────┐
intake ───▶ │  plan    │ ────────▶ │ implement│ ────────▶ │  review  │ ─▶ ...
            └──────────┘           └──────────┘           └──────────┘
                │                       │                       │
            specs/0001-…           specs/api/*              quality-gates/gates/05-agent-contract.md
            skills/core/           agents/core/             skills/core/verification-before-completion/
            brainstorming/         implementer.md           requesting-code-review/
            writing-plans/         skills/core/implement/
```

---

## 2. Folder map (authoritative)

```
mnemonics-csp-fixed/
├── AGENTS.md                       ★ this file
├── README.md                         product brief (P0/P1 scope)
│
├── apps/                             pnpm workspace — product code
│   ├── api/                          Supabase Edge / capture API
│   ├── extension/                    Manifest V3 extension
│   └── web/                          React dashboard
│
├── packages/                         pnpm workspace — shared libs
│   ├── ai/                           embedding + tag generation
│   ├── database/                     Supabase types + pgvector helpers
│   ├── shared/                       cross-package types/utils
│   └── ui/                           design system
│
├── docs/                             human-facing documentation
│
├── scripts/                          build/utility scripts
│
├── agents/                           WHO acts (this document, §3)
├── skills/                           HOW they act (this document, §4)
├── workflows/                        WHEN/WHAT-ORDER (this document, §5)
├── specs/                            WHAT the contract is (this document, §6)
├── quality-gates/                    IS IT GOOD ENOUGH (this document, §7)
│
└── vendor/                           ★ read-only upstream sources
    ├── ponytail/                       github.com/dietrichgebert/ponytail
    ├── mattpocock-skills/              github.com/mattpocock/skills
    ├── karpathy-skills/                github.com/multica-ai/andrej-karpathy-skills
    ├── agency-agents/                  github.com/msitarzewski/agency-agents
    └── superpowers/                    github.com/obra/superpowers
```

Anything you add must land in exactly **one** of these layers. If you are tempted to
add a top-level folder, open an ADR in `specs/adr/` first.

---

## 3. `agents/` — Who is acting

An **agent** is a role with a persona, boundaries, and a contract (see
`specs/0002-agent-contract.md`). Agents do not embed business logic — they invoke
**skills** to do work.

* **`agents/core/`** — reusable across any project.
  `orchestrator`, `planner`, `implementer`, `code-reviewer`, `security-reviewer`,
  `doc-writer`, `incident-responder`.
* **`agents/product/`** — roles specific to Mnemonics (e.g. `capture-quality-agent`,
  `ocr-tagger-agent`, `semantic-search-agent`, `rag-pipeline-agent`).
* **`agents/curated/`** — vetted role files cherry-picked from
  `vendor/agency-agents/specialized/`. Add a file here **only** when its scope is
  reusable beyond a single skill. Otherwise promote it to `core/` or `product/`.

Never copy a vendor agent file into `agents/` and edit it without changing the YAML
frontmatter `source:` field. Vendor files are immutable; we keep them under
`vendor/` for that reason. See `specs/0002-agent-contract.md` for the frontmatter
schema.

---

## 4. `skills/` — How they act

A **skill** is a deterministic, repeatable procedure with a `SKILL.md` frontmatter.
It is invoked **by name**, often by an agent or a workflow.

* **`skills/core/`** — reusable across any project.
* **`skills/product/`** — Mnemonics-specific (e.g. `ocr-pipeline`, `auto-tagging`,
  `semantic-search`).
* **`skills/_templates/`** — the SKILL.md frontmatter template and authoring guide.

Skill-loading rules:

1. **Karpathy guidelines first.** Before doing *anything* in this repo, any agent
   **must** read [`skills/core/karpathy-guidelines/SKILL.md`](skills/core/karpathy-guidelines/SKILL.md).
   This is the highest-priority rule and overrides any conflicting rule below.
2. If the user explicitly says "use the brainstorming skill" or "run TDD", read the
   matching `SKILL.md` and follow it.
3. Skills with the same name in `core/` and `product/` — `product/` wins **only** if
   the task is product-specific.
4. The **default interaction mode** is `karpathy-guidelines + brainstorming + writing-plans`
   for new features; `systematic-debugging + verification-before-completion` for bug fixes.

---

## 5. `workflows/` — When and in what order

A **workflow** is a sequence of states + transitions + gates. Every workflow in this
repo is a path through the state machine defined in
[`workflows/state-machine.md`](workflows/state-machine.md).

* **`workflows/state-machine.md`** — the canonical finite-state machine.
* **`workflows/core/`** — engineering workflows (feature dev, bug investigation,
  incident response, release, onboarding).
* **`workflows/product/`** — Mnemonics workflows (capture → knowledge pipeline,
  semantic query, …).

Workflows must:

* Declare their entry state, exit state, allowed transitions.
* Enumerate which **gates** are evaluated between transitions.
* Reference (not duplicate) the **specs** and **skills** they depend on.

---

## 6. `specs/` — What the contract is

A **spec** is the single source of truth for an interface. Code that contradicts a
spec is a bug; a spec that contradicts reality is unmaintained. Both should fail CI.

* **`specs/0001-system-overview.md`** — supersedes and extends `docs/architecture.md`.
* **`specs/0002-agent-contract.md`** — frontmatter schema for every agent.
* **`specs/0003-skill-contract.md`** — frontmatter schema for every SKILL.md.
* **`specs/0004-workflow-state-machine.md`** — auto-generated, do not edit by hand.
* **`specs/api/`** — REST/Edge-function contracts.
* **`specs/data/`** — DB schema, pgvector config.
* **`specs/adr/`** — Architecture Decision Records, named `NNNN-kebab-case.md`.

The first spec you must read is `0001-system-overview.md`. Then `0002-agent-contract.md`
and `0003-skill-contract.md` define the metadata schema for everything in `agents/`
and `skills/`.

---

## 7. `quality-gates/` — Is it good enough to ship?

A **gate** is a single boolean check. Workflows list which gates they need to pass
between transitions. Gates are run by **runners** (`.sh` or `.mjs` scripts); agents
never run gates themselves.

Eight gates ship out of the box:

| # | Gate                          | When it runs            |
|---|-------------------------------|-------------------------|
| 1 | `01-style.md`                 | pre-commit, CI          |
| 2 | `02-typecheck.md`             | pre-commit, CI          |
| 3 | `03-test-coverage.md`         | pre-merge, CI           |
| 4 | `04-security.md`              | pre-merge, nightly      |
| 5 | `05-agent-contract.md`        | on any change in `agents/` |
| 6 | `06-skill-frontmatter.md`     | on any change in `skills/` |
| 7 | `07-spec-sync.md`             | on any change in `specs/` or `apps/` |
| 8 | `08-knowledge-regression.md`  | pre-merge (RAG/search)  |

Runners live in `quality-gates/runners/`. Hooks (Cursor + pre-commit) live in
`quality-gates/hooks/`.

---

## 8. Operating principles for any agent

These principles are non-negotiable. They are a *summary* of
[`skills/core/karpathy-guidelines/SKILL.md`](skills/core/karpathy-guidelines/SKILL.md);
when in doubt, that file wins.

1. **Read before you write.** Open the relevant spec/skill/ADR before changing code.
   If you can't find one, write one first.
2. **Single source of truth.** Never duplicate. If two files say the same thing, one
   of them is wrong.
3. **Smallest viable change.** No speculative refactors, no defensive layers for
   problems that don't exist.
4. **Verify before completion.** Every claim must be checkable; every "done" must be
   proven by a gate.
5. **Honesty over flattery.** If something is over-engineered, say so and delete it.
6. **Spec → code, never code → spec.** The spec exists before the code. If you find
   yourself editing a spec to match code, write an ADR explaining why.
7. **State transitions are gates.** Moving from "implement" to "review" without
   passing `quality-gates/gates/02-typecheck.md` and `03-test-coverage.md` is a bug
   in the workflow itself.

---

## 9. Quick-start for an agent that just spawned

1. Read this file. (`AGENTS.md`)
2. Read [`skills/core/karpathy-guidelines/SKILL.md`](skills/core/karpathy-guidelines/SKILL.md).
3. Read [`specs/0001-system-overview.md`](specs/0001-system-overview.md).
4. Check the user's request:
   * Is it a **new feature**? → `skills/core/brainstorming` → `skills/core/writing-plans` → workflow `workflows/core/01-feature-development.md`.
   * Is it a **bug**? → `skills/core/systematic-debugging` → workflow `workflows/core/02-bug-investigation.md`.
   * Is it a **release**? → workflow `workflows/core/04-release.md`.
   * Is it **product-pipeline** (capture / OCR / embed / search)? → workflow `workflows/product/capture-to-knowledge.md`.
5. Pick the right **agent** in `agents/` and follow the state machine.

If you skip step 1 or 2, the next reviewer will catch you.

---

## 10. Maintenance

* Adding a new layer (e.g. `policies/`) requires an ADR first.
* Editing any agent/skill/workflow must not change its **`source:`** field.
* Updating `specs/0001-system-overview.md` requires review by `agents/core/code-reviewer.md`.

— end of AGENTS.md —
