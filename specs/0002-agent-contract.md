# Spec 0002 — Agent contract

> Defines the frontmatter and body contract for every file under `agents/`.

## 1. Scope

Every file at `agents/**/*.md` is an **agent role description**. Each must
declare the frontmatter defined below. The contract is enforced by gate
[`../quality-gates/gates/05-agent-contract.md`](../quality-gates/gates/05-agent-contract.md).

## 2. Frontmatter schema (required fields)

```yaml
---
name: string                       # kebab-case, unique within agents/
version: semver                    # e.g. 0.1.0
source: enum                       # hand-authored | agency-agents | superpowers | karpathy | ponytail
status: enum                       # draft | stable | deprecated
layer: enum                        # agents (fixed)
maturity: enum                     # experimental | production
role: enum                         # core | product | curated
owners: string[]                   # GitHub handles; empty until assigned
inputs:             relative-path[]  # spec paths the agent requires
outputs:            relative-path[]  # artefacts (paths) the agent produces
skills:             relative-path[]  # SKILL.md files this agent invokes
gates:              relative-path[]  # gate files this agent owns/passes
input_descriptions:  string[]         # FREE PROSE; not enforced
output_descriptions: string[]         # FREE PROSE; not enforced
---
```

Optional fields:

```yaml
---
depends_on:  string[]               # agent names this role cannot run without
escalates_to: string                # agent name to escalate to on failure
---
```

## 3. Body sections (in order)

1. `# {{title-case-name}}` — heading matching `name:`.
2. **Persona** — one paragraph, single voice.
3. **Mission** — one or two sentences.
4. **Boundaries** — bullet list of negative rules.
5. **Workflows** — bullet list of workflow paths.
6. **Skills** — bullet list, ordered.
7. **Inputs** — bullet list of spec/data inputs (prose).
8. **Outputs** — bullet list of artefacts produced (prose).
9. **Quality gates** — bullet list of gates this agent passes.
10. **Related** — bullet list of specs, ADRs, sibling agents.

## 4. Naming

* `name:` is `kebab-case` and equals the file name without extension.
* Filename under `agents/core/`, `agents/product/`, or `agents/curated/`.

## 5. Validation

The gate runner reads every `agents/**/*.md` and verifies:

* Frontmatter parses as YAML.
* Required fields present.
* `name:` matches the filename.
* All paths in `inputs/outputs/skills/gates` exist on disk.
* `source: agency-agents|karpathy|superpowers|ponytail` requires a
  `vendored_from:` line in the body.
* `input_descriptions` and `output_descriptions` are free prose and
  are **not** path-checked. Use them for human-only context.

## 6. See also

* [`specs/0003-skill-contract.md`](0003-skill-contract.md)
* [`specs/0004-workflow-state-machine.md`](0004-workflow-state-machine.md)
