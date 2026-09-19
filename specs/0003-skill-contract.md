# Spec 0003 — Skill contract

> Defines the frontmatter and body contract for every SKILL.md file.

## 1. Scope

Every file at `skills/**/SKILL.md` is a **skill**. Skills are invoked by name
from agents or workflows. Each must declare the frontmatter below.

Two flavours are recognised:

* **Vendored** — `source:` is `superpowers|mattpocock|karpathy|ponytail`,
  body is **byte-identical** to upstream. The companion
  `skill.meta.yaml` declares our contract fields.
* **Hand-authored** — `source: hand-authored`, body is fully under our control.

## 2. Frontmatter schema

### Vendored (in `skill.meta.yaml`)

```yaml
name: <kebab-case>             # taken from SKILL.md frontmatter if present, else folder
version: 0.1.0
source: superpowers | mattpocock | karpathy | ponytail
status: stable
layer: skills
maturity: experimental
role: core | product
vendored_skill_md: SKILL.md     # path inside the skill folder
```

### Hand-authored (in SKILL.md itself)

```yaml
name: <kebab-case>
version: semver
source: hand-authored
status: draft | stable | deprecated
layer: skills
maturity: experimental | production
role: core | product
description: <one sentence — what>
when_to_use: <short phrase — when>
inputs: relative-path[]
outputs: relative-path[]
related_specs: relative-path[]
related_agents: relative-path[]
gates: relative-path[]
---
```

## 3. Body sections (hand-authored)

1. `# Skill: {{title}}` — heading.
2. **When to use** — short paragraph.
3. **Inputs** — bullet list.
4. **Outputs** — bullet list.
5. **Procedure** — numbered checklist (the deterministic body).
6. **Anti-patterns** — bullet list of negative rules.
7. **Related** — links.

## 4. Validation

Enforced by gate
[`../quality-gates/gates/06-skill-frontmatter.md`](../quality-gates/gates/06-skill-frontmatter.md):

* `skill.meta.yaml` exists for every skill folder.
* Hand-authored SKILL.md has all required frontmatter fields.
* Vendored SKILL.md is byte-identical to `vendor/<source-repo>/<path>`.
* `inputs/outputs/related_*` paths exist.

## 5. See also

* [`specs/0002-agent-contract.md`](0002-agent-contract.md)
* [`skills/README.md`](../skills/README.md)
