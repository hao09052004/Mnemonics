# Figma-style Dashboard UI — Design Spec

> **Status:** draft, awaiting user review
> **Date:** 2026-10-04
> **Scope:** Web dashboard SPA (`apps/web/`) — authenticated routes only

## 1. Goal

Replace the current `apps/web/` authenticated UI with a Figma-style
dashboard implementation taken from `figma-ui-reference/`. The new UI
must:

- Bind 1-to-1 to the existing `apps/api/` REST contract — no new BE endpoints
- Render real data from `/api/v1/items`, `/api/v1/spaces`, `/api/v1/search`
- Look identical (or near-identical) to the Figma reference in light/dark mode
- Pass the existing `apps/web/` test suite + add new tests for the new pages
- Leave marketing/auth pages (`/`, `/login`, `/signup`, `/reset-password`,
  `/browser-extension`) **unchanged** for this iteration

## 2. Non-goals

- No Tailwind / no PostCSS. Tokens ship as plain CSS in
  `apps/web/src/styles/dashboard.css` (reference uses raw CSS variables).
- No new API endpoints, schema migrations, or auth changes.
- No marketing redesign. `Header.tsx`, `Footer.tsx`, `Hero.tsx`, etc.
  stay exactly as they are.
- Reminders page is rendered as a **disabled stub** — BE has no
  reminders table; we show a "Coming soon" page and route stays
  resolvable so the header link doesn't 404.

## 3. Mapping Figma reference ↔ existing code

### 3.1 Pages

| Figma reference page | Old route | New route | Source component |
|---|---|---|---|
| Everything | `/app` | `/app` | `DashboardPage.tsx` rewritten |
| Spaces | `/app/spaces` | `/app/spaces` | `SpacesPage.tsx` rewritten |
| Space Detail | `/app/spaces/:id` | `/app/spaces/:id` | `SpaceDetailPage.tsx` rewritten |
| Rediscover | (new) | `/app/rediscover` | new file |
| Reminders | (new) | `/app/reminders` | new file (disabled stub) |
| Settings | (new) | `/app/settings` | new file (reuses auth pages chrome) |
| Detail modal | (overlay) | (overlay in `Detail.tsx`) | `ItemDetailModal.tsx` replaced |
| Capture sheet | (overlay) | (overlay) | `QuickCapture.tsx` reused (logic) + new sheet (UI) |

### 3.2 Memory-kind mapping

The reference defines six `Memory.type` values:
`image | article | highlight | note | screenshot | document`.

The BE's `items.kind` is restricted to:
`link | text | image | screenshot` (see
`apps/api/src/routes/search.ts:29` Zod enum).

We map FE-side labels to BE values via a single function in
`apps/web/src/lib/memory-kind.ts`:

| FE label | BE `kind` value | Notes |
|---|---|---|
| `note` | `text` | user-authored note, no source URL |
| `article` | `link` | link with title/text |
| `highlight` | `link` | link selected with `selectedText` (ref shows quote style) |
| `image` | `image` | uploaded image |
| `screenshot` | `screenshot` | uploaded screenshot |
| `document` | (no BE match) | rendered as disabled card; never expected from API |

A reverse map (`kind → label`) is used to:
- Decide card visual treatment (`.memory-card.article`, `.memory-card.highlight`, etc.)
- Decide filter chip labels

Card variants in Figma reference (`article`, `highlight`, `note`, `image`,
`screenshot`, `document`) are implemented with simple CSS classes. We
keep all six classes but only five render real data (`document` is
never produced).

### 3.3 Top-nav pages (header)

The Figma reference uses a **top horizontal nav** with:
`Everything · Favorites · Spaces · Rediscover · Reminders`. The current
project uses a **left rail** (`DashboardShell.tsx`). We **switch to top
nav** for the new dashboard, because that's the reference's signature
visual. Marketing pages keep the existing marketing `Header.tsx`.

The new `DashboardTopNav.tsx` lives in
`apps/web/src/components/dashboard/DashboardTopNav.tsx` and is mounted
by the rewritten `DashboardShell.tsx`.

### 3.4 Mobile

Reference shows a bottom mobile nav (`MobileNav`). We add a minimal
`<MobileBottomNav>` under `apps/web/src/components/dashboard/` that
mirrors the five header items + a central "Capture" button.

## 4. Data flow (unchanged)

- `apps/web/src/lib/api-client.ts` stays the single API surface.
- We **add** `apps/web/src/lib/memory-kind.ts` (mapping helpers).
- We **do not** modify `apps/web/src/lib/api-client.ts` unless a method
  is missing. (Audit: `listItems`, `getItem`, `search`,
  `listSpaces`, `getSpace`, `listSpaceItems`, `addItemToSpace`,
  `removeItemFromSpace`, `createSpace`, `deleteSpace`, `getItemEnrichment`,
  `patchTldr`, `createCapture`, `createImageCapture`, `getRelatedItems`,
  `itemsByTag`, `getSignedImageUrl`, `loadStoredSession`, `saveSession`,
  `getValidAccessToken`, `refreshSession`, `logout`, `listSuggestions`,
  `refreshSuggestions`, `acceptSuggestion`, `dismissSuggestion` —
  if any are missing they get added to `api-client.ts`; otherwise
  untouched.)

## 5. Component inventory (new + rewritten)

```
apps/web/src/
├── components/dashboard/
│   ├── DashboardShell.tsx          (rewritten — top nav layout)
│   ├── DashboardTopNav.tsx         (new)
│   ├── DashboardUserMenu.tsx       (new — avatar + settings dropdown)
│   ├── MobileBottomNav.tsx         (new)
│   ├── MemoryCard.tsx              (rewritten — 6 variants)
│   ├── MemoryCardSkeleton.tsx      (new)
│   ├── CaptureCard.tsx             (new — Figma dashed "Start typing...")
│   ├── CaptureSheet.tsx             (new — replaces QuickCapture overlay)
│   ├── ContentTypeChipRow.tsx      (rewritten — All/Notes/Articles/Images/Screenshots/Highlights/Documents)
│   ├── SearchZone.tsx              (rewritten — large input + ⌘K kbd)
│   ├── SpacesGrid.tsx              (new — extracted from SpacesPage)
│   ├── SpaceDetailHeader.tsx       (new)
│   ├── RediscoverPanel.tsx         (new)
│   ├── RemindersStub.tsx           (new — disabled stub)
│   ├── DetailOverlay.tsx           (rewritten — replaces ItemDetailModal)
│   ├── EmptyState.tsx              (rewritten — Figma empty mark)
│   └── SkeletonMasonry.tsx         (new)
├── pages/
│   ├── DashboardPage.tsx           (rewritten — uses Everything view)
│   ├── SpacesPage.tsx              (rewritten)
│   ├── SpaceDetailPage.tsx         (rewritten — uses Everything view, filtered by space)
│   ├── RediscoverPage.tsx          (new)
│   ├── RemindersStubPage.tsx       (new)
│   └── SettingsPage.tsx            (new)
├── lib/
│   ├── memory-kind.ts              (new — kind ↔ label mapping)
│   └── (existing files unchanged)
├── styles/
│   ├── dashboard.css               (rewritten — Figma reference tokens)
│   └── (global.css, tokens.css unchanged)
```

Marketing pages (`components/marketing/*`) and auth pages (`LoginPage`,
`SignupPage`, etc.) are **not touched**.

## 6. CSS strategy

- Single file `apps/web/src/styles/dashboard.css` written by hand
  (transcribed from Figma reference with adjustments to use the
  existing CSS variables in `tokens.css` where they overlap).
- All class names use the `mn-dash-` prefix (or the reference's
  unprefixed class names — choose one). Decision: **unprefixed** to
  keep the reference copy/paste-friendly, but the file is imported
  only by the dashboard, never by marketing.
- Responsive breakpoints match the reference (`1190`, `1000`, `760`).
- Inter font + DM Mono are imported inside `dashboard.css` only.

## 7. Tests

- **Existing tests that must still pass:**
  - `apps/web/src/lib/__tests__/api-client.test.ts`
  - `apps/web/src/lib/__tests__/auth-layout.test.tsx`
  - `apps/web/src/lib/__tests__/browser-detect.test.ts`
  - `apps/web/src/lib/__tests__/install-button.test.tsx`
  - `apps/web/src/lib/__tests__/install-button-edge.test.tsx`
  - `apps/web/src/lib/__tests__/product-config.test.ts`
  - `apps/web/src/lib/__tests__/routing.test.tsx`
  - `apps/web/src/components/__tests__/MemoryCard.test.tsx`

- **New tests added:**
  - `apps/web/src/components/dashboard/__tests__/DashboardTopNav.test.tsx`
    — highlights active page, fires `onNavigate`
  - `apps/web/src/components/dashboard/__tests__/MemoryCard.test.tsx`
    — six variants render with the correct eyebrow + image dims
  - `apps/web/src/components/dashboard/__tests__/SearchZone.test.tsx`
    — focused state + ⌘K shortcut wiring
  - `apps/web/src/components/dashboard/__tests__/CaptureSheet.test.tsx`
    — opens, lists 4 actions, fires callback
  - `apps/web/src/lib/__tests__/memory-kind.test.ts`
    — covers all forward/reverse map rows + the disabled-document path
  - `apps/web/src/pages/__tests__/DashboardPage.test.tsx`
    — renders empty state, renders one card per item, fires search
  - `apps/web/src/pages/__tests__/SpacesPage.test.tsx`
    — list + suggestions + create dialog
  - `apps/web/src/pages/__tests__/RemindersStubPage.test.tsx`
    — renders "Coming soon"

- **Tests removed (because the corresponding components are removed):**
  - `apps/web/src/components/__tests__/MemoryCard.test.tsx` is replaced
    by the new `apps/web/src/components/dashboard/__tests__/MemoryCard.test.tsx`

## 8. Cleanup rules

After implementation:

1. Delete every old file that is no longer imported anywhere:
   - `apps/web/src/components/MemoryCard.tsx` (replaced)
   - `apps/web/src/components/MemoryEmpty.tsx` (replaced)
   - `apps/web/src/components/MemoryFilterBar.tsx` (replaced)
   - `apps/web/src/components/MemorySearch.tsx` (replaced)
   - `apps/web/src/components/MemorySkeleton.tsx` (replaced)
   - `apps/web/src/components/QuickCapture.tsx` (replaced)
   - `apps/web/src/components/CapturePromptCard.tsx` (replaced)
   - `apps/web/src/components/ItemDetailModal.tsx` (replaced)
   - `apps/web/src/components/Icon.tsx` (kept — used by marketing; verify)
   - `apps/web/src/components/dashboard/DashboardShell.tsx` (replaced)

2. Delete old tests if their component is deleted:
   - `apps/web/src/components/__tests__/MemoryCard.test.tsx` is removed

3. Keep marketing/auth files untouched.

4. After deletion, run `pnpm --filter @mnemonics/web typecheck` and
   `pnpm --filter @mnemonics/web test`. Failures = orphans left.

## 9. Out-of-scope cleanup (deferred)

- Delete `apps/web/src/components/marketing/*` → future spec.
- Delete `apps/web/src/pages/{HomePage,BrowserExtensionPage,LoginPage,SignupPage,ResetPasswordPage,NotFoundPage}.tsx` → future spec.
- Delete `apps/web/src/components/dashboard/DashboardShell.tsx`'s old exports → handled in this PR.

## 10. Review focus (top 5 uncovered failure modes)

The following scenarios are **not directly tested** by any task's unit
tests but a reasonable user will hit them:

1. **Token expiry mid-search** — user types a query, the bearer expires
   before `/api/v1/search` returns. Expected: redirect to login, do not
   show stale hits.
2. **Empty search string** — pressing Enter or clicking Search with
   empty input must NOT call the API and must NOT clear the list.
3. **Item with no `image_url`** — card must render text-only with a
   generic icon, no broken image icon, no layout shift.
4. **`kind === 'document'` from a stale API** — must render a disabled
   card and never crash the masonry.
5. **`/app/reminders` deep link** — must render the stub without
   crashing when `localStorage` has no session.

Each is pinned to a test in the owning task's steps.

## 11. Open questions

None — all major decisions were settled during intake:
- scope: authenticated dashboard only
- mapping: link→article, text→note/highlight, image/screenshot kept
- Reminders: disabled stub
- stack: plain CSS, no Tailwind

End of spec.