# SPEC: Extension Dashboard

> Owner: `agents/core/frontend-engineer.md` (vanilla JS / CSP-constrained).
> Source UI: `figma-ui-reference/` (React + Tailwind) — ported to vanilla JS + plain
> CSS to satisfy Chrome MV3 `script-src 'self'` and the absence of a build step
> for `apps/extension/*.html`.

This spec is the contract for `apps/extension/mnemonics-dashboard.html` and
`apps/extension/dashboard.js`. It is intentionally narrower than
`/specs/0001-system-overview.md` — that doc describes the whole product;
this one specifies **the offline dashboard tab** opened by the popup.

## 1. Surface

* **File**: `chrome-extension://<extension-id>/mnemonics-dashboard.html`
* **Open from**: `mnemonics-extension.html` popup → click `Dashboard`.
* **Auth**: must be signed in; otherwise render the login screen inline.
* **CSP**: `script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:4000 https://*.supabase.co; img-src 'self' data: blob: https: chrome-extension:;`
  No inline scripts, no external CDNs, no Tailwind, no React. **Vanilla JS + plain CSS only.**

## 2. Routes / pages (vanilla router, no URL routing)

The dashboard is a single HTML page. The active route is held in
`state.route` and reflected in the DOM by toggling a `data-route` attribute on
`<body>` and showing/hiding the matching `<section data-route="...">`.

| Route | Purpose | Data source |
|-------|---------|-------------|
| `everything` | Default. All items, filterable by kind. | `GET /api/v1/items` |
| `favorites` | Items where `is_favorite = true`. | `GET /api/v1/items?favorite=true` |
| `spaces` | List of spaces (collections). | `GET /api/v1/spaces` |
| `space-detail` | Items in one space. | `GET /api/v1/spaces/:id/items` |
| `rediscover` | Surfaces forgotten items (sampled 30/60/90 days old). | `GET /api/v1/items` filtered by `captured_after` |
| `reminders` | Reminders (todo + meeting). | `GET /api/v1/items?type=note` (notes with checks) + local reminders from extension storage |
| `settings` | Account, extension, AI processing toggles. | local session + `GET /api/v1/auth/me` |
| `login` | Inline auth UI (replace landing page entirely). | `/api/v1/auth/login`, `/register`, `/forgot-password` |

Routing is event-driven, not URL-driven — `state.route` is the source of truth.
Back button is provided by the browser; we restore the last route from
`chrome.storage.local` on load so a refresh keeps the user where they were.

## 3. Top navigation

Exactly the 5-tab top nav from `figma-ui-reference/src/App.tsx` plus a
Capture button and avatar. Layout = horizontal top bar, NOT a side rail.

```
+--------------------------------------------------------------+
|  [m] mnemonics | Everything | Favorites | Spaces | Rediscover | Reminders | [Capture] [AC] |
+--------------------------------------------------------------+
```

* Active tab: text colour `--text`, bottom border `2px solid --purple`.
* Inactive tab: text colour `--muted`, hover → `--secondary`.
* Capture button: filled `--purple`, opens the Capture sheet (modal).
* Avatar: 34×34 circle, initials, click → `Settings` route.

This is a **top nav**, NOT a side rail — confirmed by the user ("đây là extension
có dashboard"). The Figma reference's `Rail` component (vertical 72px sidebar) is
**not used** for the extension.

## 4. Search zone (hero)

```
[ 🔍 Search your memories… | ⌘ K ]
```

* Placeholder: `"Search your memories…"`
* Input font-size 18px, weight 400.
* Width: constrained to `max-width: 760px` on desktop; full width on mobile.
* ⌘K / Ctrl+K shortcut focuses the input.
* Debounce: 350ms idle → `POST /api/v1/search`.
* Skeleton state: 9 pulsing placeholders.
* Below the input: `"N memories saved this month"` (count from API).

## 5. Content-type filter chips

Pill row, single-select. Selected chip uses `--purple-soft` background +
`--purple` border. Order is fixed:

```
All | Notes | Articles | Images | Screenshots | Highlights | Documents
```

Mapping from API `kind` (`link`, `text`, `image`, `screenshot`) to chip label:

| Chip | API `kind` values |
|------|------------------|
| Notes | `text` (without checks) |
| Articles | `link` |
| Images | `image` (uploaded via right-click / context menu) |
| Screenshots | `screenshot` (cropped) |
| Highlights | `text` where `ocr_text` is non-empty and is the entire body |
| Documents | not yet supported by BE → chip disabled with `aria-disabled` and tooltip "Coming soon" |

Document is **explicitly stubbed** — the FE shows the chip but the BE has no
`document` kind. The chip is rendered as disabled and explains why.

## 6. Memory card variants

`figma-ui-reference/src/App.tsx` defines 6 variants. The extension dashboard
implements all 6 even though backend storage is only `link`/`text`/`image`/`screenshot`,
because the FE reference is the spec.

| Variant | Trigger | Visual |
|---------|---------|--------|
| `article` | `kind === 'link'` | Image preview 164px, title, excerpt, source, tags |
| `note` | `kind === 'text'` (no checks) | No image, taller card body, eyebrow tag pill, footer |
| `highlight` | `kind === 'text'` + only OCR-derived text (no `raw_text`) | Quote-style, large 20px title, no image |
| `image` | `kind === 'image'` | Image preview 220px, title, short desc, tags |
| `screenshot` | `kind === 'screenshot'` | Image preview 190px, "Screenshot" eyebrow |
| `document` | not yet supported by BE | Rendered only when BE returns `kind === 'document'`; otherwise stub |

The variant is decided by `kindToVariant(kind, item)` (see §11).

## 7. Card hover state

* `background: var(--hover)` = `#272B35`
* `border-color: var(--border-strong)`
* Card actions (heart + more) opacity goes from 0 → 1.
* No transform on hover (extension does not need lift animation; keeps scroll stable).

## 8. Detail modal

Replaces the existing `reader-modal`. Two columns:

```
+--------- media (left, 1.85fr) ----------+----- side (right, 1fr) -----+
| [×]                                     | EYEBROW · TYPE    [more]    |
|                                         | <h1>title</h1>              |
|  <img src=...>  OR  text-preview block  | 🔗 source · saved today     |
|                                         | TLDR (small label)          |
|                                         | <p>summary</p>  [copy][edit]|
|                                         | Tags (chips)                |
|                                         | Your notes (textarea)       |
|                                         | > Image Description         |
|                                         | > Detected Text             |
|  [−]  100%  [+]                         | Related Memories ◌          |
|                                         | [thumb][thumb][thumb]       |
|                                         | [♥] [share] [open source →] |
+-----------------------------------------+-----------------------------+
```

* Open: clicking any memory card opens this modal.
* Close: `×` button, `Esc` key, click backdrop.
* `data-route="detail"` is set on `<body>` while open. Header + nav are still
  visible above (modal sits under them with `z-index: 30`).

## 9. Capture sheet

Triggered by the `Capture` button in the top nav. Bottom-sheet on mobile,
centered modal on desktop.

```
+-----------------------+
| Capture a memory       |
+-----------------------+
| 🔗 Save Link          → |
| +  Quick Note         → |
| 🖼  Upload Image       → |
| ⬆  Upload Document    → |
+-----------------------+
```

Each entry is a one-shot shortcut that posts a message to the background
service worker (`chrome.runtime.sendMessage`):

* `Save Link` → uses current tab `url` + `title` → calls `uploadTextCapture` →
  `POST /api/v1/captures` with `type: link`.
* `Quick Note` → opens a tiny inline form (title + note), then `type: text`.
* `Upload Image` → opens file picker → `uploadImageCapture` →
  `POST /api/v1/captures/image` with `type: image`.
* `Upload Document` → **stubbed**: chip rendered but click shows a toast
  "Document uploads coming soon — backend doesn't expose this kind yet."
  The action is not destructive (no API call, no UI lock); it just informs
  the user the feature isn't available. We keep the entry so the FE stays
  consistent with the Figma reference and so the disabled state is honest
  rather than silently missing.

## 10. State management

Single module-scoped object:

```js
const state = {
  route: 'everything',          // current route
  user: null,                   // session.user (from chrome.storage.local)
  items: [],                    // current list (after server fetch + sort + filter)
  spaces: [],                   // spaces for the spaces route
  search: {
    query: '',
    inFlight: false,
    hits: null                  // server hits, overrides items when present
  },
  filter: {
    kind: 'all',                // one of: all, link, text, image, screenshot
    favoritesOnly: false
  },
  detail: null,                 // open detail item
  capture: false,               // capture sheet open
  loading: false,               // any fetch in flight
  error: null                   // last error message
};
```

Mutations are routed through `setState(patch)` which always re-renders the
affected region (`renderTopNav`, `renderCards`, `renderDetail`, etc.). No
virtual DOM, no diffing — direct DOM updates via `innerHTML` rebuilds for
list regions, targeted updates for singleton regions (top nav, modal).

## 11. Kind mapping (FE adapter)

`apps/extension/dashboard.js` exports `kindToVariant(kind, item)`:

```js
function kindToVariant(kind, item) {
  if (kind === 'link') return 'article';
  if (kind === 'screenshot') return 'screenshot';
  if (kind === 'image') return 'image';
  if (kind === 'text') {
    // A text item is rendered as a highlight when there's no raw_text
    // and only OCR text — captures from an image where the body was
    // entirely OCR'd. Otherwise it's a regular note.
    if (item && !item.raw_text && item.ocr_text) return 'highlight';
    return 'note';
  }
  if (kind === 'document') return 'document';
  return 'note';                // safe fallback
}
```

`variantToKind(variant)` is the inverse, for the chip filter:

```js
function variantToKind(variant) {
  return {
    note: ['text'],
    article: ['link'],
    image: ['image'],
    screenshot: ['screenshot'],
    highlight: ['text'],        // highlights ARE text items in the BE
    document: ['document']      // currently empty in BE
  }[variant] || ['text'];
}
```

## 12. API contract (per-route)

| Route | Endpoint | Body / params | Response |
|-------|----------|---------------|----------|
| `everything`, `favorites`, `rediscover`, `reminders` | `GET /api/v1/items?limit=50&offset=0&favorite=true?` | query string | `{ data: { items, total, limit, offset } }` |
| Search | `POST /api/v1/search` | `{ q, filters: { kind[], tags[], captured_after?, captured_before? }, limit, offset }` | `{ hits: [{ id, kind, title, snippet, score, captured_at, tags }] }` |
| Spaces | `GET /api/v1/spaces` | — | `{ data: { spaces, total } }` |
| Space detail | `GET /api/v1/spaces/:id/items?limit=50&offset=0` | path + query | `{ data: { items, total, limit, offset } }` |
| Patch | `PATCH /api/v1/items/:id` | `{ title?, notes?, isFavorite?, tags? }` | `{ success, item: { id, isFavorite?, tags? } }` |
| Delete | `DELETE /api/v1/items/:id` | — | `204` |
| Refresh image URL | `GET /api/v1/items/:id/image-url` | — | `{ data: { id, image_url } }` |

All calls go through `apps/extension/api-client.js` (existing) so the auth
refresh and 401-retry loop is shared with the popup.

## 13. Auth

* On load: `getAccessToken()` → if no session, render `login` route.
* If session present but token expired: try `refreshAccessToken()`. If
  refresh fails, drop to `login`.
* Login form posts `/api/v1/auth/login`, stores session, refreshes top nav.
* Logout: clears `mnemonics_session` from chrome.storage, returns to `login`.

## 14. Cleanup & legacy

The new dashboard removes:

* `SPACES_DATA` hardcoded sample data — replaced by `GET /api/v1/spaces`.
* `DEFAULT_REMINDERS` hardcoded sample data — reminders page reads only items.
* `BOOK_CATALOG` book-suggestion rail — removed (product-pipeline cut).
* `renderBookRail` — removed.
* `TOPIC_OPTIONS` topic detection — removed.

The new dashboard keeps:

* `api-client.js`, `auth-client.js`, `background.js`, `extension.js` untouched.
* Auth code (`handleLogin`, `handleSignup`, etc.) inlined into the new flow.
* Search filters + recent searches UX (chipped in from M2/M4).
* Reader-modal mental model, re-skinned as the new Detail modal (§8).

## 15. Quality gates

1. `pnpm --filter @mnemonics/extension-tests test` passes (existing vitest
   tests for `api-client`, `auth-client`, `pending-sync-policy` are unaffected).
2. Manual smoke test:
   - [ ] Without login: renders `login` route.
   - [ ] With login: fetches items, renders `everything` masonry.
   - [ ] Filter to `Notes`: list shrinks to `text`-kind items.
   - [ ] Search "abc": debounced `POST /api/v1/search`, renders hits.
   - [ ] Click a card: detail modal opens with media + side panels.
   - [ ] Esc closes detail; × button closes detail.
   - [ ] Capture sheet: clicking Save Link routes to a text capture.
   - [ ] Switch to Spaces route: list of spaces rendered.
3. CSP check: no inline `<script>` (must be external `dashboard.js`), no
   external CDN imports, no `eval`, no `new Function`.
4. Visual smoke test: open in Chrome unpacked-extension, confirm dark
   palette + top nav + masonry match the Figma reference.