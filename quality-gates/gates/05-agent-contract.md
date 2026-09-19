# Gate 05 — Agent contract

* **Owner:** `agents/core/orchestrator.md`
* **Runner:** `../runners/check-agents.mjs`
* **Fires on:** any change under `agents/`, on `pre-commit`, on `CI`
* **Failure semantics:** blocks transitions `intake → plan` and
  `plan → implement`.

## Rule

Every file under `agents/**/*.md` must:

* Parse as Markdown with a YAML frontmatter block.
* Declare all required fields per [`../../specs/0002-agent-contract.md`](../../specs/0002-agent-contract.md).
* Have `name:` matching the file name (sans `.md`).
* Reference only paths that exist on disk (in `inputs/outputs/skills/gates`).
* If `source: agency-agents|karpathy|superpowers`, the body must contain a
  `vendored_from:` line.

## Evidence

Per-file report at `quality-gates/.logs/05-agent-contract-<date>.log`.

## Remediation

1. Run `node scripts/seed-skill-metas.mjs` for sidecar generation patterns.
2. Fix the offending file's frontmatter.
3. Re-run the runner.
