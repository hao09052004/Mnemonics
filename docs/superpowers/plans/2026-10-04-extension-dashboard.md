# Plan: Extension Dashboard (Figma-style vanilla JS)

**Status**: implemented (see `specs/api/dashboard-extension.md`).
**Owner**: frontend-engineer (vanilla JS, no React/Tailwind).
**Targets**: `apps/extension/mnemonics-dashboard.html`, `apps/extension/dashboard.js`,
`apps/extension/styles/tokens.css`.

> **Historical implementation plan.** This plan describes how the current
> Figma-style extension dashboard was built. Some details (most notably
> the `Reminders` view and the `Upload Document` chip) were intentionally
> left as disabled / stubbed states because the BE has no `document` kind
> and no `reminders` table yet. For the current Spaces contract (Manual +
> Smart, no Suggested Spaces), see [`../spaces.md`](../spaces.md). For
> current implementation status, see
> [`../m3-m4-status.md`](../m3-m4-status.md).

---

## 1. Spec

See `specs/api/dashboard-extension.md`. Single source of truth — read first.

## 2. Tasks

Each task is its own commit. Order matters: spec → tokens → html skeleton →
dashboard.js skeleton → render functions → wiring → cleanup.

### T1. Tokens & palette (1 commit)

- [ ] Open `apps/extension/styles/tokens.css`.
- [ ] Rename `--mn-*` variables to match Figma reference exactly:
  `--bg`, `--surface`, `--elevated`, `--hover`, `--text`, `--secondary`,
  `--muted`, `--purple`, `--purple-soft`, `--border`, `--radius`, plus
  `--purple-button`, `--purple-button-hover`, `--purple-pressed`,
  `--purple-text`, `--on-primary`, `--focus-ring`, `--overlay`, `--success`,
  `--warning`, `--error`.
- [ ] Keep `--mn-*` as backward-compat aliases pointing at the new vars
  (so `mnemonics-extension.html`, `screenshot-cropper.html`,
  `original-image.html` keep working).
- [ ] Add `font-family: var(--font-sans)` reference using a system stack
  (no Google Fonts, CSP-safe).
- [ ] Smoke test: open `mnemonics-extension.html` — popup still renders with
  the new palette, no regressions in markup.

### T2. HTML skeleton (1 commit)

- [ ] Rewrite `apps/extension/mnemonics-dashboard.html`:
  - `<head>`: charset, viewport, `<link rel="stylesheet" href="styles/tokens.css">`,
    inline `<style>` block scoped to `.mnx-*` classes (extension-local namespace
    so it doesn't collide with the global `--mn-*`).
  - `<body data-route="everything">`
    - `<header class="mnx-topnav">` with logo, tabs, capture button, avatar
    - `<main class="mnx-main">` with route containers (each `<section
      data-route="...">`)
    - `<div class="mnx-detail-shell">` (detail modal — hidden by default)
    - `<div class="mnx-sheet-backdrop">` (capture sheet — hidden by default)
    - `<div class="mnx-toast">` (transient status pill — hidden by default)
- [ ] Include scripts in correct order:
  `<script src="auth-client.js" type="module">`,
  `<script src="api-client.js">`,
  `<script src="dashboard.js" type="module">`.
- [ ] CSP check: no inline scripts, all `<script>` tags are `src=` references.

### T3. CSS — shell, top nav, search, chips, cards (1 commit)

- [ ] Top nav: horizontal layout, sticky to top, height 80px desktop / 68px mobile.
- [ ] Search zone: pill input (max-width 760px, height 54px, border-radius 10px,
  focus → `--purple` border + `--focus-ring` shadow).
- [ ] Filter chips: pill row, single-select, scrollable on mobile.
- [ ] Memory card: 12px radius, `--border` border, 4-column masonry desktop
  (`columns: 4 230px; column-gap: 20px`), 1-column mobile, image height
  220px (image), 164px (article), 190px (screenshot).
- [ ] Card variant overrides (`.memory-card.article`, `.memory-card.note`,
  `.memory-card.highlight`, `.memory-card.image`, `.memory-card.screenshot`,
  `.memory-card.document`).
- [ ] Detail modal: two-column grid, `grid-template-columns: minmax(0,1.85fr) minmax(340px,1fr)`.
- [ ] Capture sheet: centered modal desktop, bottom-sheet mobile.
- [ ] Mobile breakpoint at 760px: collapse top nav into mobile bottom nav
  with 5 tabs + floating capture button.

### T4. dashboard.js — state, routing, render functions (1 commit)

- [ ] Define `state` object per spec §10.
- [ ] `setState(patch)` — mutates state, calls targeted renders.
- [ ] `showRoute(route)` — toggles `data-route` attribute, swaps sections.
- [ ] `renderTopNav()` — highlights active tab.
- [ ] `renderMain()` — dispatches to the right render function by route.
- [ ] `renderEverything()`, `renderSpaces()`, `renderRediscover()`, `renderReminders()`,
  `renderSettings()`, `renderLogin()`.
- [ ] Empty state, loading skeleton, error state for each.

### T5. dashboard.js — data fetches (1 commit)

- [ ] `fetchItems({ favorite, kind, captured_after, captured_before })` →
  `GET /api/v1/items`.
- [ ] `searchItems(q, filters)` → `POST /api/v1/search`.
- [ ] `fetchSpaces()` → `GET /api/v1/spaces`.
- [ ] `fetchSpaceItems(spaceId)` → `GET /api/v1/spaces/:id/items`.
- [ ] `patchItem(id, patch)` → `PATCH /api/v1/items/:id` (via background).
- [ ] `deleteItem(id)` → `DELETE /api/v1/items/:id` (via background).
- [ ] `refreshImageUrl(id)` → `GET /api/v1/items/:id/image-url`.
- [ ] Token refresh through `getAccessToken()` + `refreshAccessToken()`.

### T6. dashboard.js — search & filters UX (1 commit)

- [ ] Search input debounce 350ms.
- [ ] Filter chips single-select.
- [ ] ⌘K / Ctrl+K shortcut.
- [ ] Recent searches (5 latest) cached in `chrome.storage.local`.
- [ ] Search result highlight (mark wrapping query).
- [ ] Skeleton during search in-flight.
- [ ] Empty / no-results state.

### T7. dashboard.js — detail modal + capture sheet (1 commit)

- [ ] Open detail on card click; close on × / Esc / backdrop.
- [ ] Detail side panel: title, source, TLDR, tags, notes, related.
- [ ] Capture sheet: 4 actions (Save Link / Quick Note / Upload Image /
  Upload Document) wired to existing capture paths (Upload Document shows
  "Coming soon" tooltip).
- [ ] Toast notification on save success / failure.

### T8. Cleanup & final wiring (1 commit)

- [ ] Delete: `SPACES_DATA`, `DEFAULT_REMINDERS`, `BOOK_CATALOG`,
  `TOPIC_OPTIONS`, `renderBookRail`, `detectTopicFromItems`.
- [ ] Inline auth: `handleLogin`, `handleSignup`, `handleForgotPassword`
  ported to render in the `login` route.
- [ ] Logout clears chrome.storage and returns to `login`.
- [ ] Settings route: account info (read from session), extension info,
  AI processing toggles (read-only stubs since BE has no toggle endpoints).
- [ ] Last route persistence in `chrome.storage.local` so a refresh keeps
  the user on the same page.
- [ ] CSP final check.

### T9. Tests + smoke (1 commit)

- [ ] Run `pnpm --filter @mnemonics/extension-tests test` → all existing
  vitest tests still pass (we didn't touch `api-client.js`, `auth-client.js`,
  `pending-sync-policy.js`).
- [ ] Manual smoke: open unpacked extension in Chrome, log in, navigate
  every route, capture, delete, search, detail modal.
- [ ] CSP check: DevTools console clean of CSP violations.

## 3. Gate checklist

- [ ] No inline `<script>` in `mnemonics-dashboard.html` (CSP).
- [ ] No `eval`, `new Function`, `setTimeout(string)` anywhere.
- [ ] All external resources load over `https:` or `chrome-extension:` only.
- [ ] Tokens carry `--mn-*` aliases so legacy surfaces keep working.
- [ ] Vitest passes.
- [ ] Manual smoke covers all 5 routes + detail modal + capture sheet.
- [ ] Search uses `POST /api/v1/search` with proper debounce + abort-on-new-query.
- [ ] All BE calls go through `api-client.js` (no raw `fetch` for `/api/v1/`).
- [ ] No hardcoded sample data anywhere (no SPACES_DATA, no DEFAULT_REMINDERS).

## 4. Out of scope

* New BE endpoints. We consume only what already exists in `apps/api`.
* Spaces CRUD UI (read-only for now — `GET /api/v1/spaces` only).
* Reminder checkboxes (the BE doesn't persist checklist state).
* Document upload kind (no BE support).
* Settings write-backs (no BE endpoints).
* Onboarding / pricing pages.

## 5. Risks

* **Vanilla JS state management can drift** → `state` is single source of
  truth, `setState` is the only mutator, renders are idempotent.
* **CSP regression** → dev-verify with Chrome's CSP violation report
  (DevTools → Console) before each commit.
* **Existing dashboard.js has 3764 lines** → we don't rewrite it line-by-line.
  We **reauthor** the surface: the new `dashboard.js` is ~600-900 lines
  targeting the Figma spec, and the old `renderCards` / `renderDashboard`
  get replaced wholesale. No incremental edits to the old code.