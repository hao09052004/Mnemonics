# Mnemonics — *Save once — Find anytime.*

A personal-knowledge-management SaaS ("Second Brain"):
**browser extension** → capture API → OCR + auto-tagging + embeddings →
**Web dashboard** with keyword + semantic search.

> This repository hosts both the product code (pnpm workspace under
> `apps/` and `packages/`) and the agent/skill/workflow/spec/quality-gate
> information architecture that drives every change. **Start at
> [`AGENTS.md`](AGENTS.md).**

---

## 1. Five layers, one rulebook

| Layer        | Folder             | Question it answers       | Owner                  |
|--------------|--------------------|---------------------------|------------------------|
| **Who**      | `agents/`          | "Who is acting?"          | orchestrator / planner |
| **How**      | `skills/`          | "What capability?"        | orchestrator           |
| **When**     | `workflows/`       | "In what order?"          | orchestrator           |
| **What**     | `specs/`           | "What is the contract?"   | code-reviewer          |
| **Good?**    | `quality-gates/`   | "Is it acceptable?"       | code-reviewer          |

Every workflow is a path through the canonical finite-state machine in
[`workflows/state-machine.md`](workflows/state-machine.md). Every transition
is gated by one or more of the eight gates defined in
[`quality-gates/gates/`](quality-gates/gates).

## 2. Repository layout

```
mnemonics-csp-fixed/
├── AGENTS.md                       ★ root rulebook
├── README.md                         this file
│
├── apps/                             pnpm workspace — product code
│   ├── api/                          Supabase Edge / capture API
│   ├── extension/                    Manifest V3 extension
│   └── web/                          React dashboard
│
├── packages/                         pnpm workspace — shared libs
│   ├── ai/                           embeddings + tag generation
│   ├── database/                     Supabase types + pgvector helpers
│   ├── shared/                       cross-package types/utils
│   └── ui/                           design system
│
├── agents/                           WHO acts (12 roles split core/product/curated)
├── skills/                           HOW they act (51 skills, vendored + hand-authored)
├── workflows/                        WHEN/WHAT-ORDER (state machine + 5 core + 2 product workflows)
├── specs/                            WHAT the contract is (4 system + 3 API + 2 data + 1 ADR)
├── quality-gates/                    IS IT GOOD ENOUGH (8 gates, 5 runners, 2 hooks, .gitignore)
│
└── vendor/                           read-only upstream sources
    ├── ponytail/                       github.com/dietrichgebert/ponytail
    ├── mattpocock-skills/              github.com/mattpocock/skills
    ├── karpathy-skills/                github.com/multica-ai/andrej-karpathy-skills
    ├── agency-agents/                  github.com/msitarzewski/agency-agents
    └── superpowers/                    github.com/obra/superpowers
```

## 3. Daily commands

```bash
# Validate the information architecture. CI runs this on every PR.
pnpm gates:all

# Regenerate skill.meta.yaml sidecars after adding vendored skills.
pnpm seed:skills

# Type-check + tests, like before:
pnpm typecheck
pnpm test
```

The current state:

* `pnpm gates:agents` — 12/12 agents ✓
* `pnpm gates:skills` — 51/51 skills ✓
* `pnpm gates:spec-sync` — all referenced paths resolve ✓

## 4. Where to start (by role)

| You are…                      | Read these (in order)                                                                                                                                              |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A new contributor (human)     | `AGENTS.md` → `README.md` → `apps/<area>/README.md` → relevant `agents/` role → relevant `skills/` for the task                                                   |
| A new agent that just spawned | `AGENTS.md` → `skills/core/karpathy-guidelines/SKILL.md` → `specs/0001-system-overview.md` → `workflows/state-machine.md` → matching workflow                          |
| Reviewing a PR                | `agents/core/code-reviewer.md` → `specs/0002-agent-contract.md` → `quality-gates/gates/05-agent-contract.md` + `06-skill-frontmatter.md` + `07-spec-sync.md`         |
| Investigating an outage       | `agents/core/incident-responder.md` → `workflows/core/03-incident-response.md` → `skills/core/systematic-debugging/SKILL.md`                                          |

## 5. Authoring rules at a glance

| If you add…                | You must…                                                                                            |
|---------------------------|------------------------------------------------------------------------------------------------------|
| A file under `agents/`    | Follow `specs/0002-agent-contract.md`. Gate `05-agent-contract.md` enforces it.                      |
| A file under `skills/`    | Have a valid SKILL.md frontmatter (or vendor sidecar). Gate `06-skill-frontmatter.md` enforces it.   |
| A file under `workflows/` | Declare states/skills/gates used; reference real files. Gate `07-spec-sync.md` enforces it.          |
| A file under `specs/`     | Reference existing code path; if you break the contract, file an ADR first.                         |
| A new gate                | Add it to the relevant workflow's `gates_used` list.                                                 |

## 6. Upstream / vendor policy

Files under `vendor/` are **read-only**. Vendored content in
`skills/core/` is copied verbatim with a `skill.meta.yaml` sidecar.

If we need to modify a vendor skill, copy it to a new path and set
`source: hand-authored` in the new file. Never modify the vendor copy.

To refresh a vendored skill:

```bash
# from the repo root
node scripts/wipe-skill-metas.mjs   # optional, only if the vendor file changed
node scripts/seed-skill-metas.mjs
pnpm gates:skills                    # sha256 must still match upstream
```

## 7. State machine

```
            gate: 01-style
   intake ─────────────────────▶ plan
     │                            │
     │ brainstorming              │ writing-plans
     │                            ▼
     └────── any state ──▶  incident
                            implement
                              │ gates: 01-style, 02-typecheck,
                              │ 03-test-coverage, 07-spec-sync
                              ▼
                            review   ◀── code-reviewer
                              │ gates: 03-test-coverage
                              ▼
                            verify   ◀── verification-before-completion
                              │ gates: 04-security, 08-knowledge-regression
                              ▼
                            release
                              │ required: workflows/runs/<date>-<slug>.md
                              ▼
                            closed
```

Full machine: [`workflows/state-machine.md`](workflows/state-machine.md).

## 8. Roadmap (in this repo)

* [x] clone five upstream sources under `vendor/`
* [x] commit `AGENTS.md` and the five-layer architecture
* [x] 12 agents, 51 skills, 5 core + 2 product workflows
* [x] 4 system specs + 3 API specs + 2 data specs + 1 ADR
* [x] 8 gates, 5 runners, 2 hooks, sha256 vendor-drift detection
* [ ] bootstrap a git repository and a first commit
* [ ] CI workflow running `pnpm gates:all` on every PR
* [ ] Knowledge-regression golden set (`quality-gates/.knowledge-regression/golden.jsonl`)
* [ ] ADR-0002 (release-day policy) and ADR-0003 (spec-sync runner details)

## 9. See also

* Product overview: [`README.md`](README.md)
* Architecture spec: [`specs/0001-system-overview.md`](specs/0001-system-overview.md)
* ADR-0001: [`specs/adr/0001-agents-skills-workflows-layout.md`](specs/adr/0001-agents-skills-workflows-layout.md)
* Operations docs: [`docs/`](docs)

— end of README —
