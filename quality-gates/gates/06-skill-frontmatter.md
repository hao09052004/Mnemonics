# Gate 06 — Skill frontmatter

* **Owner:** `agents/core/orchestrator.md`
* **Runner:** `../runners/check-skills.mjs`
* **Fires on:** any change under `skills/`, on `pre-commit`, on `CI`
* **Failure semantics:** blocks transitions `intake → plan`.

## Rule

For every `skills/**/SKILL.md`:

* If `source: hand-authored` → the SKILL.md itself must contain the full
  contract frontmatter (per [`../../specs/0003-skill-contract.md`](../../specs/0003-skill-contract.md)).
* Otherwise (`source: superpowers|mattpocock|karpathy|ponytail`) → a
  companion `skill.meta.yaml` must exist with the same contract fields and a
  `vendored_skill_md: SKILL.md` reference.
* The vendored SKILL.md body must be byte-identical to
  `vendor/<source-repo>/<path>` (sha256 compared).

## Evidence

Per-skill report at `quality-gates/.logs/06-skill-frontmatter-<date>.log`.

## Remediation

1. Re-run `node scripts/seed-skill-metas.mjs` to (re)create sidecars.
2. If a vendor file has drifted from upstream, re-sync with the vendor and
   bump the `version:` field.
