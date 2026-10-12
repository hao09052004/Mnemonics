# `agents/curated/` — Adapted vendor roles

Files in this folder are **adapted from `vendor/agency-agents/`** with attribution
preserved via the `source:` frontmatter field. They are immutable beyond their
frontmatter; if you need to change the body, copy it into `agents/core/` or
`agents/product/` instead and rewrite it under our contract.

## Rules

1. **Vendor files are read-only.** Their canonical version lives in
   `vendor/agency-agents/<division>/<file>.md`. Do not edit those.
2. **Curated files must declare `source: agency-agents/<division>/<file>`** in
   their frontmatter.
3. **Don't duplicate widely.** Only curate a role if it (a) is reusable in this
   project AND (b) has no equivalent in `agents/core/` or `agents/product/`.
4. **Gate `05-agent-contract.md` runs on this folder too.** Vendor adaptations
   that violate the contract will be rejected.

## Currently curated

This folder is intentionally empty for the moment. When adding a curated agent,
follow the template in `../_templates/agent.template.md` and link the upstream
commit hash in the header.

To propose one, open a PR with:

* a single file in `agents/curated/`
* a one-line entry in the table below

| File | Upstream | Owner | Status |
|------|----------|-------|--------|
| —    | —        | —     | —      |
