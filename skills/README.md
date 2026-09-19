# `skills/` — *How* an agent acts

A **skill** is a deterministic, repeatable procedure an agent can invoke by name.
Skills are **not** agents — they have no persona, no authority. An agent invokes
a skill to do work; a skill returns artefacts, not decisions.

> **First rule of this repo:** any agent must read
> [`core/karpathy-guidelines/SKILL.md`](core/karpathy-guidelines/SKILL.md) **before**
> doing anything else. See [`../AGENTS.md`](../AGENTS.md), §4.

## Folder layout

| Folder           | Purpose                                                                                          |
|------------------|--------------------------------------------------------------------------------------------------|
| `_templates/`    | `SKILL.md` template + authoring guide. Always start here.                                        |
| `core/`          | Skills reusable across any project. Sourced from `vendor/superpowers/`, `vendor/mattpocock-skills/`, `vendor/karpathy-skills/`, `vendor/ponytail/`. |
| `product/`       | Skills scoped to Mnemonics (OCR pipeline, auto-tagging, semantic search, …).                     |

## SKILL.md frontmatter contract

Every `SKILL.md` must declare the frontmatter described in
[`../specs/0003-skill-contract.md`](../specs/0003-skill-contract.md). Gate
[`../quality-gates/gates/06-skill-frontmatter.md`](../quality-gates/gates/06-skill-frontmatter.md)
enforces it.

Minimum required fields:

```yaml
---
name: kebab-case-name
version: 0.1.0
source: superpowers|mattpocock|karpathy|ponytail|hand-authored
status: draft|stable|deprecated
layer: skills
maturity: experimental|production
role: core|product
---
```

## Sourcing rules

* Files in `core/` are **copied verbatim** from `vendor/<repo>/skills/<path>/SKILL.md`,
  with `source:` pointing at the upstream. Vendored files may not be modified.
* If you must modify a vendored skill, copy it to a new path **without** `source:`
  set to a vendor — set `source: hand-authored` and link the upstream in the
  file body.
* Files in `product/` are `source: hand-authored`.

## Skill loading priority (highest → lowest)

1. `core/karpathy-guidelines` — **always load first**.
2. `core/using-superpowers` — meta-skill: tells the agent which others to load.
3. Task-class skills (`brainstorming`, `systematic-debugging`, `tdd`, …).
4. Domain skills (`product/*`).

## Authoring a new skill

1. Copy [`_templates/SKILL.md`](_templates/SKILL.md).
2. Fill in the frontmatter.
3. Keep the body short. Prefer checklists to prose. Prefer one canonical example
   over three mediocre ones.
4. Add an entry to this README's index.
5. Open a PR; CI will run gate `06-skill-frontmatter.md`.
