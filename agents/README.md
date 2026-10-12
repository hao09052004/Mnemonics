# `agents/` — *Who* is acting

This directory holds **role definitions** for every agent that may work on this
project. An agent is a *persona with boundaries*, not a service. Every agent:

1. Reads [`../AGENTS.md`](../AGENTS.md) first.
2. Reads [`../skills/core/karpathy-guidelines/SKILL.md`](../skills/core/karpathy-guidelines/SKILL.md) first.
3. Declares a YAML frontmatter matching [`../specs/0002-agent-contract.md`](../specs/0002-agent-contract.md).
4. Invokes **skills** to do work; agents do not embed logic.

## Sub-directories

| Folder                | Purpose                                                                                  |
|-----------------------|------------------------------------------------------------------------------------------|
| `core/`               | Roles reusable across any project (orchestrator, planner, implementer, reviewer, …).     |
| `product/`            | Roles scoped to the Mnemonics product (capture-quality, ocr-tagger, semantic-search, …).|
| `curated/`            | Vendor roles adapted with a `source:` field. See [`README.md` in this folder](./curated/README.md). |
| `_templates/`         | The agent markdown template with frontmatter.                                            |

## Which agent do I pick?

* Any coding work → `core/implementer.md` (handoff to `product/<area>-agent.md` if specialised).
* Reviewing a PR → `core/code-reviewer.md` **and** `core/security-reviewer.md` for security-impacting diffs.
* Documenting → `core/doc-writer.md`.
* On a Sev incident → `core/incident-responder.md`.
* Orchestrating multi-step tasks → `core/orchestrator.md`.

For Mnemonics specifically:

* Capture quality issue in the extension → `product/capture-quality-agent.md`.
* OCR or auto-tagging regression → `product/ocr-tagger-agent.md`.
* Semantic-search ranking / relevance issue → `product/semantic-search-agent.md`.
* RAG pipeline breakage → `product/rag-pipeline-agent.md`.
* Knowledge graph or relationship extraction → `product/knowledge-graph-agent.md`.

## Authoring rules

* Filename is `kebab-case.md` and matches the frontmatter `name:` field.
* A new agent file must compile under `specs/0002-agent-contract.md`. Gate
  `quality-gates/gates/05-agent-contract.md` enforces this in CI.
* When curating from `vendor/agency-agents/`, copy the file, **add** a `source:`
  frontmatter field, and link the upstream commit in the header. Do not edit the
  upstream content; treat it as read-only.
