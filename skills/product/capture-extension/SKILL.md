---
name: capture-extension
version: 0.1.0
source: hand-authored
status: draft
layer: skills
maturity: experimental
role: product
description: "Wire the Manifest V3 extension to the capture API correctly."
when_to_use: "when implementing a capture flow in apps/extension"
inputs:
  - capture payload from content script
outputs:
  - request to apps/api/capture
  - local cache entry
related_specs:
  - specs/api/capture.md
  - specs/data/supabase-schema.md
related_agents:
  - agents/product/capture-quality-agent.md
gates:
  - quality-gates/gates/04-security.md
---

# Capture extension skill

## Procedure

1. Validate the captured payload against `specs/api/capture.md` (zod).
2. Strip PII the spec marks as `redact` before sending.
3. Send `POST /api/capture` with auth token (never in URL).
4. On 2xx, cache the returned `document_id` against the local URL.
5. On 4xx/5xx, surface a friendly error; do **not** retry 4xx.

## Anti-patterns

* Never log the auth token.
* Never send raw selection HTML — sanitise.
