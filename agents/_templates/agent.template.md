---
name: {{slug}}
version: 0.1.0
source: hand-authored
status: draft
layer: agents
maturity: experimental
role: {{one of core | product | curated}}
owners: []
inputs: []      # list of spec paths the agent requires
outputs: []     # list of artefacts the agent produces
skills: []      # list of skills the agent invokes
gates: []       # list of gates the agent owns
---

# {{title-case-name}}

> One-paragraph summary of the agent. State the persona, the boundaries, and the
> single success criterion.

## Mission

What the agent exists to do. Be terse.

## Boundaries

What the agent **must not** do. These are negative rules.

## Workflows

Which `workflows/*.md` files this agent drives.

## Skills

Which `skills/**/*.md` files this agent invokes, and in what order.

## Inputs

Contract: what data/context the agent expects to receive.

## Outputs

Contract: what artefacts the agent must produce.

## Quality gates

Which `quality-gates/gates/*.md` files this agent is responsible for passing
before declaring a task done.

## Related

* ADRs: (link)
* Specs: (link)
* Skills: (link)
