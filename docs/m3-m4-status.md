# Mnemonics — M3 / M4 Implementation Status

> Snapshot after the most recent work session. Use this as the entry
> point for manual testing and as a checklist for the next session.

---

## 1. What ships now

### Feature A — Server-Backed Spaces ✅

| Area | Status |
|---|---|
| Database migrations (`014_spaces.sql`, `015_item_enrichments.sql`) | ✅ |
| `SpaceRepository`, `EnrichmentRepository` (`packages/database`) | ✅ |
| Dynamic-space rule engine (`matchDynamicSpace`) | ✅ |
| Suggested-space generator (`generateSpaceSuggestions`) | ✅ |
| REST API (`/api/v1/spaces`, `/api/v1/items/:id/enrichment`, `/api/v1/items/:id/tldr`) | ✅ |
| Manual + Dynamic Spaces in web (`/app/spaces`, `/app/spaces/:id`) | ✅ |
| `AddToSpacePopover` | ✅ |
| Ownership isolation everywhere | ✅ |
| Tests (38 unit + 7 e2e) | ✅ |

### Feature B — Memory Understanding ✅

| Area | Status |
|---|---|
| `item_enrichments` schema (caption, tldr, status, source, prompt_version) | ✅ |
| `LocalImageDescriptionProvider` (Transformers.js) | ✅ |
| `DeterministicTldrProvider` (Vietnamese + English) | ✅ |
| `OllamaTldrProvider` (optional, FREE) | ✅ |
| Async pipeline: `ocr → tag → embed → enrich` | ✅ |
| Embedding text builder uses `Title + TLDR + Caption + Content + OCR` | ✅ |
| Lexical search boosts `tldr` ('A') and `caption` ('C') | ✅ |
| Manual-TLDR protection (`tldr_source = 'user'`) | ✅ |
| `ItemDetailModal` (two-column, TLDR editor, collapsible OCR, image description) | ✅ |
| Failure UX ("Image description is temporarily unavailable." + Retry) | ✅ |
| Lazy / singleton model loading + concurrency cap | ✅ |
| Tests (78 unit + integration) | ✅ |

### UX refinements added in this session

- **Dashboard card** with sticky `TLDR` line for fast scan.
- **ItemDetailModal**:
  - Two-column layout
  - Compact TLDR with copy / edit / regenerate
  - Collapsible OCR ("Show all" / "Hide")
  - Collapsible AI image description
  - Related memories, removable from the list
  - "Add to Space" popover reachable from detail header
- **Spaces overview**:
  - "My Spaces" cards with memory count, last-updated, hover preview
  - "Suggested Spaces" with Accept / Dismiss
  - Empty-state nudge
- **Space detail**:
  - Header with edit pencil, memory count
  - Internal search (semantic + keyword, falls back to client-side filter)
  - Grid of memory cards
  - "Remove from Space" with inline confirm
  - "Add Memory" popover to drop more items in
- **AddToSpacePopover**:
  - Search by name, recents list, "Create new Space" inline
  - Check-mark feedback on success

### Taste-skill alignment

We deliberately followed `vendor/taste-skill/skills/redesign-skill/SKILL.md`:

- Quiet typography, 1px hairline dividers, no glow / no shadow stacks.
- 4 / 8 / 12 / 16 px spacing scale.
- Soft, semantic motion (`transition: 150–200ms ease-out`).
- No emoji icons inside product UI (text labels or thin SVGs only).
- Hover states and focus rings are explicit and high-contrast.
- Cards have visible top accent (color hint by item type).
- AI states use plain language: "Understanding image…" → "Ready".

---

## 2. New / changed routes

```
GET    /api/v1/spaces
POST   /api/v1/spaces
GET    /api/v1/spaces/:id
PATCH  /api/v1/spaces/:id
DELETE /api/v1/spaces/:id
POST   /api/v1/spaces/:id/items
DELETE /api/v1/spaces/:id/items/:itemId
GET    /api/v1/spaces/:id/items
POST   /api/v1/spaces/suggestions/refresh
GET    /api/v1/spaces/suggestions
DELETE /api/v1/spaces/suggestions/:id

GET    /api/v1/items/:id/enrichment
PATCH  /api/v1/items/:id/tldr
POST   /api/v1/items/:id/tldr/regenerate
```

Web routes:

```
/app/spaces                  → SpacesPage (My + Suggested)
/app/spaces/:id              → SpaceDetailPage
/app/memories/:id            → ItemDetailModal (overlay, two-column)
```

---

## 3. Database migrations (apply in order)

```
014_spaces.sql               — spaces, space_items, space_rules, space_suggestions
015_item_enrichments.sql     — item_enrichments (caption, tldr, status, source)
```

If you previously created a `spaces` table from the M1 prototype, run a
manual `DROP TABLE` first; the canonical schema is in `014_spaces.sql`.

---

## 4. New env variables (see `.env.example`)

```
AI_FREE_ONLY=true
AI_ALLOW_PAID_PROVIDERS=false
AI_IMAGE_DESCRIPTION=true
AI_IMAGE_DESCRIPTION_PROVIDER=local
LOCAL_IMAGE_DESCRIPTION_MODEL=Xenova/vit-gpt2-image-captioning
AI_TLDR_ENABLED=true
TLDR_MAX_LENGTH=240
TLDR_MAX_SENTENCES=2
AI_TLDR_MIN_TEXT_LENGTH=160
OCR_PROVIDER=local
OCR_LOCAL_FALLBACK=true
OCR_SPACE_API_KEY=
GEMINI_API_KEY=
GEMINI_VISION_MODEL=
LOCAL_AI_MAX_CONCURRENCY=1
IMAGE_AI_MAX_DIMENSION=1024
IMAGE_AI_TIMEOUT_MS=30000
```

---

## 5. Quality gates

```
pnpm typecheck        ✅  all 6 packages
pnpm test             ✅  289 passed, 1 skipped
pnpm build            ✅  all 5 packages
pnpm gates:all        ✅  4/4 gates green
pnpm ai:check         ✅  FREE-ONLY mode
```

---

## 6. Manual test checklist

Use this list in the browser to confirm UX:

1. **Capture an image**
   - Screenshot capture → status `Understanding image…` for 3–6 s.
   - Card on the dashboard shows TLDR after status flips to `Ready`.
   - Open the card → modal has TLDR editor, collapsible OCR & image description.

2. **Capture a text note**
   - Card shows TLDR + tags.
   - Modal: TLDR edit → saves; clicking "Regenerate" asks for confirmation.

3. **Create a Manual Space**
   - `/app/spaces` → "New Space" → name + icon.
   - Card appears under "My Spaces".

4. **Create a Dynamic Space**
   - Same modal, switch to "Dynamic" tab → add a `type = image` rule.
   - Item count updates automatically as matching items become `ready`.

5. **Suggested Spaces**
   - After 3+ captures, click "Refresh suggestions".
   - At least one cluster appears with `Create Space` / `Dismiss`.

6. **Add-to-Space popover**
   - From a card menu or from the modal header.
   - Search an existing Space, or create inline.

7. **Search inside a Space**
   - Inside `/app/spaces/:id`, type a keyword.
   - Empty state message appears if no matches.

8. **Remove a memory from a Space**
   - Hover a card → "Remove from Space" → confirm.

9. **Edit TLDR**
   - Open modal → click pencil → save.
   - Re-open the same item; TLDR is preserved, badge shows "Your edit".

10. **Disable cloud AI**
    - In `.env` set `AI_FREE_ONLY=true`, no `GEMINI_API_KEY`.
    - Restart API. Everything must still work.

---

## 7. Known limitations

- `LocalImageDescriptionProvider` downloads the model on first use; the
  first OCR+caption run can take 10–30 s depending on the connection.
- The in-memory similarity link in the e2e test is best-effort
  (`Unhandled fake pool query: …`) — items still go `ready` because the
  embed handler already marks the item before the similarity pass.
- Suggested Spaces use a deterministic title generator (top-3 keywords
  + topic). It is intentionally boring; replace with a local LLM call
  (e.g. Ollama) when one is available.

---

## 8. Next session candidates

- Server-side preset rules ("favorite in last 30 days") in the dynamic
  Space rule editor.
- Bulk-apply suggestions ("Add 3 similar memories to this Space").
- Time-of-day / "memory of the day" panel driven by `tldr`.
- Per-user CLIP visual similarity for image Spaces.
