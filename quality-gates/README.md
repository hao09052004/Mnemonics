# `quality-gates/` — *Is it good enough?*

A **gate** is a single boolean check. Workflows list which gates they need to
pass between transitions. Gates are run by **runners** (`.sh` or `.mjs`
scripts). **Agents never run gates themselves** — they only read gate status.

## Folder layout

| Folder      | Purpose                                                            |
|-------------|--------------------------------------------------------------------|
| `gates/`    | One markdown per gate (spec, owner, runner, failure mode).         |
| `runners/`  | The actual scripts that return PASS/FAIL with evidence.            |
| `hooks/`    | Cursor and pre-commit hooks that wire gates into the developer loop.|

## The eight shipped gates

| # | Gate                            | Owning agent                   | Runner                                |
|---|---------------------------------|--------------------------------|---------------------------------------|
| 1 | `01-style.md`                   | `core/code-reviewer.md`        | `runners/lint-all.sh`                 |
| 2 | `02-typecheck.md`               | `core/implementer.md`          | `pnpm --recursive typecheck`          |
| 3 | `03-test-coverage.md`           | `core/implementer.md`          | `pnpm --recursive test` + threshold  |
| 4 | `04-security.md`                | `core/security-reviewer.md`     | `runners/lint-all.sh` + bandit-equivalent |
| 5 | `05-agent-contract.md`          | `core/orchestrator.md`         | `runners/check-agents.mjs`            |
| 6 | `06-skill-frontmatter.md`       | `core/orchestrator.md`         | `runners/check-skills.mjs`            |
| 7 | `07-spec-sync.md`               | `core/code-reviewer.md`        | `runners/check-spec-sync.mjs`         |
| 8 | `08-knowledge-regression.md`    | `core/quality-owner.md`        | `runners/knowledge-regression.mjs`    |

## Wiring to hooks

| Hook                   | Gates enforced                                       |
|------------------------|------------------------------------------------------|
| `hooks/post-edit.cmd`  | 01-style, 02-typecheck, 05-agent-contract, 06-skill-frontmatter |
| `hooks/pre-tool-use.cmd`| 04-security (when the tool is `Bash`/`Write`)       |

## Authoring a new gate

1. Add `NN-short-name.md` under `gates/`.
2. Implement a runner under `runners/` that exits 0 on PASS and non-zero on
   FAIL. The runner must print the gate id, the rule that failed, and a
   remediation pointer.
3. Wire it into at least one workflow in `workflows/`.
4. Open an ADR if the gate introduces a new external dependency.

## Failure discipline

A gate that fails **must** block the transition. Skipping is a violation of
`AGENTS.md §8`. The orchestrator cannot advance past a failed gate; it must
escalate.
