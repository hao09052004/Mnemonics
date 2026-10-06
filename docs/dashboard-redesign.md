# Mnemonics Dashboard Redesign — M5

> Visual-density reference: a calm dark "second-brain" dashboard
> (`REFERENCE A`). Goal: make the Mnemonics authenticated surface feel
> as polished, immersive, calm and content-first — **without copying
> REFERENCE A's product identity**.

---

## What changed (and why)

### 1. Dark, content-first canvas
- Authenticated routes (`/app/*`) now sit on `#111318` with a faint
  radial top-light.
- Marketing routes keep the existing light tokens — toggled via
  `[data-theme="marketing"]`.
- Purple `#7457e8` is reserved for: search focus, filter pills when
  active, related-memory glints, brand chip, primary CTA, focus ring.
  The canvas itself stays neutral.

### 2. Single Inter Variable type system
- `Inter Variable` ships **locally** via `@fontsource-variable/inter`
  — no runtime Google Fonts dependency.
- The marketing site kept its editorial display face on select pages;
  the dashboard uses Inter for everything (display + body + mono
  fallback) so the surface reads as one calm canvas.
- Scale: hero `clamp(34px, 4vw, 56px)` → card title 16 → body 14 →
  meta 12 → micro 11. Letter-spacing `-0.015em` on headings.

### 3. Hero search anchor
- Replaced the bordered `SearchBar` input with a hero input: no
  border, single bottom rule, autofocused on first mount.
- `⌘ K` / `Ctrl K` from anywhere on the dashboard focuses the search.
- The search stays visually quiet; results drive the canvas below.

### 4. Compact 60px left rail
- Icon-driven navigation: Mọi thứ / Spaces / Yêu thích / Cài đặt.
- Brand mark `M` in a violet chip at the top.
- Bottom-anchored logout initials.
- Mobile (≤ 760px): rail collapses into a fixed bottom nav.

### 5. Top nav (quiet contextual)
- Three-link row on desktop: `Mọi thứ · Spaces · Yêu thích`.
- Memory count + avatar on the right.
- Sticky, blurred, hairline-bordered.

### 6. Filter pills (no full-width box)
- Pill row: `Tất cả / Trang / Trích đoạn / Ảnh / Screenshot / Ghi chú
  / Bài viết / Tài liệu`.
- Internal types (`link`, `text`) are mapped to user-facing labels.
- Active = brand-soft + brand dot.
- Secondary filters (`Yêu thích`, sort selector) live inline + a
  popover for advanced options — no more giant bordered filter panel.

### 7. Memory canvas = responsive masonry
- CSS `column-count` (4 / 3 / 2 / 1 at viewport widths 1480 / 980 /
  620).
- Cards keep their natural height — TLDR-driven, not equal-card-grid.
- First card is a subtle "Bắt đầu một suy nghĩ…" capture prompt so
  the action sits **inside** the canvas, not as a header button.

### 8. Card system
- Image-first when present (no big white margin, lazy-loaded).
- TLDR is the primary description. Title is the heading. Card
  hierarchy: kind + source → title → TLDR → tags → relative time.
- "Đang hiểu…" is a pulsing dot, never a giant READY/PROCESSING badge.
- Action buttons (heart, layers, trash) reveal on hover.
- Related-memory **glint** — a tiny violet dot in the top-right of the
  card when at least one related memory is known. This is one of the
  Mnemonics-specific touches that makes the surface unmistakable.
- Type-coded 2px top accent: brand for image/screenshot, neutral
  for text/link. Same in `SpaceCard`.

### 9. Loading + empty
- Skeleton cards in five height profiles so the masonry never shifts
  when real cards arrive.
- Empty state is centred, single-CTA, no big admin panel.

### 10. Quick capture is now an overlay modal
- Triggered from the in-canvas `CapturePromptCard` (the first slot)
  or the rail.
- Dark, single accent, focus-trapped, Esc-to-close.

### 11. Item detail
- Modal background switched from light cream to dark.
- Type label is "TRÍCH ĐOẠN / BÀI VIẾT / …" instead of "Ghi chú / Hình
  ảnh".
- Heading weight reduced from 800 → 600 to feel calmer.
- Type icon replaced with an inline SVG icon (no emoji).
- Action buttons restyled for dark canvas.

### 12. Spaces consistency
- Spaces page and Space detail page now use the same dark shell,
  same `MemoryCard`, same filter bar, same search.
- SpaceCard has a brand-violet top accent for smart spaces; manual
  uses a neutral hairline accent.
- Suggested-Space gradients are not part of the current surface:
  Suggested Spaces were removed in migration
  `018_spaces_v2_smart_rules.sql`. Smart Spaces are saved searches,
  not `AI`-generated clusters, so they reuse the existing palette.

### 13. AddToSpacePopover
- Dark surface, hairline border, brand CTA — sits cleanly over a
  dark card.

---

## Files changed

### Created
| File | Purpose |
|---|---|
| `apps/web/src/components/Icon.tsx` | Inline SVG icon set (36 icons, no third-party dep) |
| `apps/web/src/components/MemorySearch.tsx` | Hero search input |
| `apps/web/src/components/MemoryFilterBar.tsx` | Pill row + secondary popover |
| `apps/web/src/components/MemoryCard.tsx` | New TLDR-driven card |
| `apps/web/src/components/MemorySkeleton.tsx` | Mixed-height skeletons |
| `apps/web/src/components/MemoryEmpty.tsx` | Calm empty state |
| `apps/web/src/components/CapturePromptCard.tsx` | First-slot capture prompt |
| `apps/web/src/styles/dashboard.css` | Single source of dashboard styles |
| `apps/web/src/components/__tests__/MemoryCard.test.tsx` | Smoke tests |

### Removed
| File | Reason |
|---|---|
| `apps/web/src/components/ItemCard.tsx` | Replaced by `MemoryCard` |
| `apps/web/src/components/SearchBar.tsx` | Replaced by `MemorySearch` |
| `apps/web/src/components/TagSidebar.tsx` | Tag listing was unused on the new dashboard |

### Modified
| File | What |
|---|---|
| `apps/web/src/styles/tokens.css` | New dark `mn-*` tokens, kept legacy aliases for the public site |
| `apps/web/src/styles/global.css` | Loads Inter Variable locally, dark canvas defaults |
| `apps/web/index.html` | Removed Google Fonts, dark anti-FOUC, Vietnamese `lang` |
| `apps/web/package.json` | Added `@fontsource-variable/inter` |
| `apps/web/src/components/dashboard/DashboardShell.tsx` | New rail + topbar + greeting |
| `apps/web/src/pages/DashboardPage.tsx` | New composition: hero → filters → masonry |
| `apps/web/src/pages/SpaceDetailPage.tsx` | Re-uses MemoryCard + MemoryFilterBar |
| `apps/web/src/pages/SpacesPage.tsx` | Dark token pass |
| `apps/web/src/components/ItemDetailModal.tsx` | Dark modal, SVG icon, calm heading |
| `apps/web/src/components/QuickCapture.tsx` | Dark overlay modal |
| `apps/web/src/components/spaces/AddToSpacePopover.tsx` | Dark surface |
| `apps/web/src/components/spaces/CreateSpaceDialog.tsx` | Dark modal |

---

## Distinctive Mnemonics-only marks
1. **Connection glint** — small violet dot in card top-right when a
   memory has related memories. Quietly surfaces the second-brain
   relationship graph in the canvas without overwhelming it.
2. **Processing pulse** — "Đang hiểu…" is a tiny animated dot, not a
   status badge. Stays calm even while jobs run.
3. **Type-coded top accent** — image/screenshot = violet rule;
   text/link = neutral rule. Visual wayfinding that doesn't shout.
4. **Hero search** — full-width input with no border box, paired with
   ⌘K shortcut. Anchors the surface.
5. **TLDR-first card hierarchy** — title → TLDR → metadata. Other
   products lead with thumbnails; we lead with the user's saved
   meaning.
6. **Capture prompt as the first card** — quick-capture is woven into
   the canvas, not parked above it.

---

## Tests + gates
- `pnpm typecheck` → all packages green
- `pnpm test` → runs the workspace test suites for `@mnemonics/shared`,
  `@mnemonics/ai`, `@mnemonics/database`, `@mnemonics/api`,
  `@mnemonics/extension-tests`, and `@mnemonics/web`. CI is the source of
  exact pass / fail counts; this snapshot deliberately does not pin them.
- `pnpm build` → all packages green
- `pnpm gates:all` → `gates:agents`, `gates:skills`, `gates:spec-sync`,
  and `gates:coverage` green

---

## Manual visual checklist

| Width | What to look for |
|---|---|
| 1440 × 900 | 4-column masonry, rail on left, hero search at top |
| 1920 × 1080 | max-width still comfortable; left + right padding ≥ 28px |
| 1024 × 768 | 3-column masonry, no overflow |
| 390 × 844 | single column, rail becomes bottom nav |

Card hover: actions appear in the bottom-right corner.
Image cards: image goes edge-to-edge with the card's rounded corners.
Highlight cards: subtle left-border quote style (not "mymind"-styled).
Spaces: smart spaces get a violet rule, manual get neutral.
Empty state: "Trí nhớ của bạn bắt đầu từ đây" + a single violet CTA.
Loading: 8-12 mixed-height skeletons, no giant horizontal bars.

---

## Known limitations
- Sidebar / bottom-nav on mobile collapses cleanly, but the
  Settings screen itself wasn't redesigned (no Settings page
  exists in M5).
- The "+ is_favorite" toggle on `MemoryCard` is wired to the prop
  but the dashboard page doesn't currently drive it (favorite is
  filter-only today). Will land in M6 alongside the PATCH endpoint.
- Search shortcuts: ⌘K is wired, but the existing API supports
  both keyword and semantic search; we don't yet surface an
  explanation of why a result matched (deferred to a future M).
- Card accents work best with images; cards that are 100% text
  lean on the type-coded accent + TLDR for hierarchy.

---

## M6 — Figma-style UI migration (draft)

> Implementation plan: `docs/superpowers/plans/2026-10-04-figma-dashboard-ui.md`.
> Spec: `docs/superpowers/specs/2026-10-04-figma-dashboard-ui.md`.

### What this migration does
- Replaces the rail-based dashboard chrome with the Figma reference's
  top horizontal nav (`Everything · Favorites · Spaces · Rediscover · Reminders`).
- Re-renders `MemoryCard` with six visual variants (`note · article ·
  highlight · image · screenshot · document`) where `highlight` is a
  promoted view of a `link` carrying `selectedText`.
- Maps BE `kind` values to FE labels via `apps/web/src/lib/memory-kind.ts`.
- Keeps marketing + auth pages untouched.
- Adds a `CaptureSheet` modal (4 actions: Save Link / Quick Note /
  Upload Image / Upload Document).
- Stubs `/app/reminders` and `/app/rediscover` as "Coming soon" because
  the BE has no tables for them yet.

### Smoke checklist

1. `pnpm dev` starts the API on `:4000` and the web app on `:5173`.
2. Open `http://localhost:5173/`, click **Login**, sign in with the dev token.
3. Header nav highlights **Everything**; masonry shows cards or empty state.
4. Type "test" in the search box → results update.
5. Click a chip → list filters by content type.
6. Click **Capture** in the top bar → `CaptureSheet` opens with 4 actions.
7. Click **Spaces** → grid renders; suggestions render below.
8. Click **Rediscover** → stub renders ("Coming soon").
9. Click **Reminders** → stub renders without crashing when no session.

### Automated verification

```
pnpm --filter @mnemonics/web typecheck      # PASS
pnpm --filter @mnemonics/web test           # 17 files / 84 tests PASS
pnpm --filter @mnemonics/web build          # 258 kB JS gz 78 kB
```

### Cleanup audit

After Task 12 the only `apps/web/src/components/` files outside of
`dashboard/`, `marketing/`, `extension/`, `auth/` are:

```
ForgotPasswordForm.tsx
LoginForm.tsx
MnemonicsWordmark.tsx
```

These are intentional — they're the auth form + the wordmark, both
still used by the marketing/auth pages.

### Rollback

If the new UI breaks, revert commits `792be1d` → `9ed84f9` and the
old rail-based shell + the old MemoryCard family come back. The
marketing pages are untouched by every commit in the range.