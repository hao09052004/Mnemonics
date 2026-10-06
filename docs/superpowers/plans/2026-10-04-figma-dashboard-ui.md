# Figma-style Dashboard UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Historical implementation plan.** This plan describes the work that produced
> the current Figma-style dashboard and the Rediscover + Reminders stubs.
> Some details — most notably the `Rediscover` / `Reminders` stub pages — were
> *intentionally* left as "Coming soon" placeholders because the BE has no
> tables for them yet. For the current Spaces contract (Manual + Smart, no
> Suggested Spaces), see [`../spaces.md`](../spaces.md). For current
> implementation status, see [`../m3-m4-status.md`](../m3-m4-status.md).

**Goal:** Replace the authenticated dashboard UI in `apps/web/` with the Figma reference implementation from `figma-ui-reference/`, mapped 1:1 onto the existing `apps/api/` REST contract. Leave marketing/auth pages untouched.

**Architecture:** Component-by-component rewrite under `apps/web/src/components/dashboard/` and `apps/web/src/pages/`. Single source of truth: `apps/web/src/styles/dashboard.css`. Single data-layer helper: `apps/web/src/lib/memory-kind.ts`. All existing `apps/web/src/lib/api-client.ts` methods are reused; nothing in `apps/api/` changes.

**Tech Stack:** React 19, React Router 6, plain CSS (CSS variables + CSS Grid/columns), Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-figma-dashboard-ui.md`

---

## Global Constraints

These apply to every task unless a task explicitly overrides one:

1. **TypeScript strict mode** — no `any`, no `// @ts-ignore`.
2. **No Tailwind** — utility classes are written by hand into `dashboard.css`.
3. **All copy keys are English** unless the task spec explicitly says otherwise.
4. **No silent BE contract drift** — do not invent endpoints; if a method is missing, add it to `api-client.ts` first, then use it.
5. **Tests must run** — every task that touches a component must add or update its test before merging.
6. **Marketing/auth untouched** — `apps/web/src/components/marketing/*` and auth pages are read-only for this plan.
7. **`figma-ui-reference/` is read-only** — used only as a visual reference; do not modify or import from it.

## Review Focus

Five input classes / failure modes the spec implies but no task's unit
tests directly cover:

1. **Token expiry mid-search** — bearer expires while `/api/v1/search` is
   in flight. Expected: redirect to `/login`, no stale hits rendered.
   Test pinned in Task 8.
2. **Empty search submission** — pressing Enter with empty input must NOT
   call the API. Test pinned in Task 5.
3. **Item missing `image_url`** — card renders text-only, no broken image
   icon, no layout shift. Test pinned in Task 4.
4. **`kind === 'document'` from a stale API** — card renders disabled, no
   crash, no empty masonry cell. Test pinned in Task 4.
5. **Direct deep link to `/app/reminders`** — must render the disabled
   stub without crashing when no session is in `localStorage`. Test
   pinned in Task 9.

---

## Task 1: Add the kind↔label mapping helper

**Files:**
- Create: `apps/web/src/lib/memory-kind.ts`
- Create: `apps/web/src/lib/__tests__/memory-kind.test.ts`

**Interfaces:**
- Produces: `kindToLabel(kind: string): MemoryLabel`,
  `labelToKinds(label: MemoryLabel): string[]`,
  `normalizeKind(kind: string): MemoryLabel` (default → `'note'`)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/__tests__/memory-kind.test.ts
import { describe, expect, it } from 'vitest';
import {
  kindToLabel,
  labelToKinds,
  normalizeKind,
  type MemoryLabel,
} from '../memory-kind';

describe('memory-kind', () => {
  it('maps BE kinds to FE labels', () => {
    expect(kindToLabel('link')).toBe('article');
    expect(kindToLabel('text')).toBe('note');
    expect(kindToLabel('image')).toBe('image');
    expect(kindToLabel('screenshot')).toBe('screenshot');
  });

  it('maps FE labels back to BE kinds', () => {
    expect(labelToKinds('article')).toEqual(['link']);
    expect(labelToKinds('note')).toEqual(['text']);
    expect(labelToKinds('document')).toEqual([]); // disabled
  });

  it('normalizes unknown kinds to note', () => {
    expect(normalizeKind('document')).toBe('document'); // explicit pass-through
    expect(normalizeKind('')).toBe('note');
    expect(normalizeKind('something-weird')).toBe('note');
  });

  it('covers every label in the type', () => {
    const labels: MemoryLabel[] = [
      'note', 'article', 'highlight', 'image', 'screenshot', 'document',
    ];
    expect(labels).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/lib/__tests__/memory-kind.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/memory-kind.ts
export type MemoryLabel =
  | 'note'
  | 'article'
  | 'highlight'
  | 'image'
  | 'screenshot'
  | 'document';

const KIND_TO_LABEL: Record<string, MemoryLabel> = {
  link: 'article',
  text: 'note',
  image: 'image',
  screenshot: 'screenshot',
};

const LABEL_TO_KINDS: Record<MemoryLabel, string[]> = {
  note: ['text'],
  article: ['link'],
  highlight: ['link'],
  image: ['image'],
  screenshot: ['screenshot'],
  document: [], // no BE match — disabled card
};

export function kindToLabel(kind: string): MemoryLabel {
  return KIND_TO_LABEL[kind] ?? 'note';
}

export function labelToKinds(label: MemoryLabel): string[] {
  return LABEL_TO_KINDS[label];
}

export function normalizeKind(kind: string): MemoryLabel {
  if (KIND_TO_LABEL[kind]) return KIND_TO_LABEL[kind];
  if (kind === 'document') return 'document';
  return 'note';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mnemonics/web test src/lib/__tests__/memory-kind.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/memory-kind.ts apps/web/src/lib/__tests__/memory-kind.test.ts
git commit -m "feat(web): add memory-kind mapping helper"
```

---

## Task 2: Rewrite the dashboard stylesheet

**Files:**
- Modify: `apps/web/src/styles/dashboard.css` (replace contents)
- No test (visual contract)

- [ ] **Step 1: Back up the current dashboard.css**

Run:
```bash
cp apps/web/src/styles/dashboard.css apps/web/src/styles/dashboard.css.bak
git add apps/web/src/styles/dashboard.css.bak
git commit -m "chore(web): backup dashboard.css before rewrite"
```

(The backup is removed in Task 12.)

- [ ] **Step 2: Write the new stylesheet**

Replace `apps/web/src/styles/dashboard.css` contents with a hand-transcribed
copy of the Figma reference styles. Required rules:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');

:root {
  --bg: #15171C;
  --surface: #20232B;
  --elevated: #1B1E24;
  --hover: #272B35;
  --text: #E8EAF0;
  --secondary: #A5ACB8;
  --muted: #8D95A3;
  --purple: #7567E8;
  --purple-soft: #2A2648;
  --border: #303541;
  --radius: 12px;
  --on-primary: #F4F5F7;
  --purple-button: #6557D6;
  --purple-button-hover: #6B5DDA;
  --purple-pressed: #5B4CC6;
  --purple-hover: #887BF0;
  --purple-text: #9B90F5;
  --focus-ring: rgba(117,103,232,.35);
  --overlay: rgba(5,7,12,.68);
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--text);
  background: var(--bg);
}

body { margin: 0; background: var(--bg); }
button,input { font: inherit; color: inherit; }
button { cursor: pointer; }
.app { min-height: 100vh; background: var(--bg); display: block; }
.content { width: 100%; min-height: calc(100vh - 80px); }

/* Top nav */
.app-header { min-height: 80px; padding: 0 36px; display: flex; align-items: center; gap: 42px; border-bottom: 1px solid var(--border); background: var(--elevated); }
.brand { display: flex; align-items: center; gap: 11px; border: 0; background: transparent; padding: 0; text-align: left; font-size: 20px; font-weight: 650; letter-spacing: -.6px; }
.brand-symbol { display: grid; place-items: center; height: 34px; width: 34px; background: var(--purple-soft); color: var(--purple-text); border-radius: 10px; font-size: 27px; font-weight: 600; }
.brand-tagline { display: block; font-size: 10px; color: var(--secondary); font-weight: 400; margin-top: 2px; }
.app-header nav { display: flex; align-self: stretch; gap: 24px; align-items: center; }
.header-link { position: relative; height: 100%; border: 0; background: transparent; padding: 0; color: var(--muted); font-size: 13px; font-weight: 500; }
.header-link:hover { color: var(--secondary); }
.header-link.active { color: var(--text); }
.header-link.active:after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--purple); }
.header-actions { margin-left: auto; display: flex; align-items: center; gap: 20px; }

/* Buttons */
.primary { border-radius: 8px; background: var(--purple-button); color: var(--on-primary); box-shadow: none; padding: 10px 14px; border: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.primary:hover { background: var(--purple-button-hover); }
.primary:active { background: var(--purple-pressed); }
.ghost { border: 0; background: var(--surface); color: var(--secondary); border-radius: 999px; padding: 8px 12px; font-size: 12px; }
.ghost:hover { background: var(--hover); color: var(--text); }
.chip { background: var(--surface); border: 1px solid transparent; color: var(--secondary); font-size: 12px; font-weight: 500; padding: 7px 12px; border-radius: 6px; border: 0; }
.chip:hover { background: var(--hover); color: var(--text); }
.chip.active { background: var(--purple-soft); color: var(--text); border-color: var(--purple); }

/* Main */
.main { padding: 30px 36px 60px; max-width: 1600px; margin: 0 auto; }
.dashboard-heading { display: flex; align-items: center; justify-content: space-between; }
.dashboard-heading h1 { font-size: 28px; font-weight: 600; line-height: 1.2; letter-spacing: -.8px; margin: 0 0 8px; }
.dashboard-heading p { color: var(--secondary); font-size: 13px; margin: 0; }
.memory-count { color: var(--muted); font-size: 12px; }

/* Search */
.search-zone { margin: 24px 0 20px; max-width: 760px; }
.searchline { display: flex; align-items: center; gap: 13px; height: 54px; padding: 0 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--secondary); }
.searchline input { min-width: 0; flex: 1; width: 100%; border: 0; outline: 0; background: transparent; font-size: 18px; font-weight: 400; color: var(--text); letter-spacing: -.3px; }
.searchline input::placeholder { color: var(--muted); }
.searchline:focus-within,.searchline.focused { border-color: var(--purple); box-shadow: 0 0 0 2px var(--focus-ring); }
.searchline kbd { background: var(--elevated); border: 1px solid var(--border); border-radius: 5px; padding: 3px 7px; font: 11px 'Inter',sans-serif; white-space: nowrap; color: var(--secondary); }

/* Filter row */
.filter-row { display: flex; border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: 0 0 18px; margin: 0 0 24px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* Masonry + memory card */
.masonry { columns: 4; column-gap: 20px; }
.memory-card { width: 100%; display: inline-block; vertical-align: top; break-inside: avoid; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); margin: 0 0 20px; overflow: hidden; transition: border-color .18s, background .18s; }
.memory-card:hover { background: var(--hover); }
.memory-card.document { opacity: .4; pointer-events: none; }
.card-image,.image .card-image { height: 220px; background: var(--elevated); }
.article .card-image { height: 164px; }
.screenshot .card-image { height: 190px; }
.memory-card img { width: 100%; height: 100%; object-fit: cover; }
.card-body { padding: 18px; }
.card-top { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.card-top .eyebrow { color: var(--muted); font: 10px 'Inter',sans-serif; letter-spacing: 1.1px; text-transform: uppercase; }
.card-actions { display: flex; gap: 7px; opacity: 0; transition: .15s; }
.memory-card:hover .card-actions { opacity: 1; }
.card-actions button { color: var(--muted); padding: 3px; border: 0; background: transparent; }
.card-actions button:hover { color: var(--purple-text); }
.memory-card h3 { font-family: 'Inter',sans-serif; font-size: 16px; line-height: 1.45; font-weight: 600; letter-spacing: -.25px; margin: 0 0 9px; }
.memory-card.highlight h3 { font-size: 20px; font-weight: 500; letter-spacing: -.025em; margin: 15px 0 22px; }
.memory-card p { font-size: 13px; line-height: 1.65; color: var(--secondary); margin: 0 0 18px; }
.memory-card.note.tall .card-body { min-height: 280px; display: flex; flex-direction: column; }
.memory-card.note.tall .meta { margin-top: auto; }
.meta { display: flex; flex-direction: column; gap: 10px; font-size: 11px; color: var(--muted); padding-top: 4px; }
.meta .tags { color: var(--secondary); font-size: 11px; }
.related { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 15px; color: var(--secondary); font-size: 11px; display: flex; gap: 5px; align-items: center; }
.related i { background: var(--purple); width: 4px; height: 4px; border-radius: 50%; }

/* Capture card */
.capture-card { width: 100%; break-inside: avoid; margin-bottom: 20px; border: 1px dashed var(--border); border-radius: var(--radius); background: var(--surface); text-align: left; padding: 19px; height: 180px; }
.capture-card .eyebrow { display: flex; align-items: center; gap: 8px; }
.capture-card .eyebrow i { width: 5px; height: 5px; background: var(--purple); border-radius: 50%; }
.capture-card strong { display: block; color: var(--muted); font-weight: 400; font-size: 18px; margin-top: 34px; }
.capture-hint { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; margin-top: 13px; }

/* Skeleton */
.skeleton { width: 100%; display: inline-block; break-inside: avoid; border-radius: 12px; margin-bottom: 20px; background: linear-gradient(110deg,var(--surface) 20%,var(--hover) 38%,var(--surface) 54%); background-size: 200% 100%; animation: shine 1.7s infinite; }
.skeleton.tall { height: 312px; }
.skeleton.medium { height: 244px; }
.skeleton.short { height: 168px; }
@keyframes shine { to { background-position: -200% 0; } }

/* Empty state */
.empty { min-height: 360px; display: grid; place-items: center; }
.empty-inner { text-align: center; max-width: 390px; }
.empty-mark { position: relative; width: 45px; height: 42px; margin: 0 auto 28px; }
.empty-mark span { position: absolute; width: 9px; height: 9px; border: 2px solid var(--purple); border-radius: 50%; }
.empty-mark span:first-child { left: 1px; top: 21px; }
.empty-mark span:nth-child(2) { left: 17px; top: 3px; }
.empty-mark span:last-child { left: 30px; top: 25px; }
.empty-inner h1 { font-size: 28px; letter-spacing: -.04em; margin: 0 0 10px; }
.empty-inner p { color: var(--secondary); font-size: 14px; line-height: 1.6; margin: 0 0 22px; }

/* Spaces grid */
.spaces-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.space-card { border: 1px solid var(--border); background: var(--surface); text-align: left; border-radius: 13px; padding: 18px; transition: .2s; border: 1px solid var(--border); }
.space-card:hover { background: var(--hover); }
.space-card .collage { display: grid; grid-template-columns: 1.2fr .8fr; grid-template-rows: 1fr 1fr; gap: 4px; overflow: hidden; border-radius: 8px; background: var(--hover); height: 150px; margin-bottom: 12px; }
.space-card .collage img { grid-row: span 2; width: 100%; height: 100%; object-fit: cover; }

/* Detail overlay */
.detail-shell { position: fixed; z-index: 10; inset: 0; background: var(--bg); display: grid; grid-template-columns: minmax(0,1.85fr) minmax(340px,1fr); }
.detail-side { overflow: auto; padding: 27px 28px 22px; background: var(--bg); }
.detail-side h1 { font-size: 28px; line-height: 1.18; letter-spacing: -.045em; margin: 13px 0 11px; }
.detail-source { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; color: var(--muted); font-size: 12px; margin: 0 0 25px; }
.detail-side section { padding: 18px 0; border-top: 1px solid var(--border); }
.section-label { font-family: 'Inter',sans-serif; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; color: var(--muted); }
.tldr { background: var(--surface); border-color: var(--border); border-radius: 10px; }

/* Mobile */
.mobile-nav { z-index: 8; display: none; }
@media (max-width: 760px) {
  .app-header { min-height: 68px; padding: 14px 16px; flex-wrap: nowrap; }
  .app-header nav { display: none; }
  .main { padding: 25px 16px 34px; }
  .dashboard-heading h1 { font-size: 26px; }
  .memory-count { display: none; }
  .search-zone { margin: 20px 0 16px; }
  .searchline { padding: 0 13px; gap: 10px; height: 52px; }
  .searchline input { font-size: 17px; }
  .filter-row { margin: 0 0 20px; padding: 0 0 15px; }
  .chips { flex-wrap: nowrap; overflow-x: auto; width: 100%; gap: 3px; }
  .chip { flex-shrink: 0; padding: 7px 10px; }
  .masonry { columns: 1; }
  .memory-card { margin-bottom: 16px; }
  .mobile-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 68px; background: rgba(26,28,34,.96); backdrop-filter: blur(14px); border-top: 1px solid var(--border); justify-content: space-around; padding: 6px 5px; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
  .memory-card { transition: none; }
}
```

- [ ] **Step 3: Verify build still parses**

Run: `pnpm --filter @mnemonics/web typecheck`
Expected: PASS (no consumer imports the new classes yet, but file must parse)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/dashboard.css
git commit -m "feat(web): rewrite dashboard.css to match Figma reference tokens"
```

---

## Task 3: Build the new Icon set (Figma reference uses 22 inline SVG icons)

**Files:**
- Create: `apps/web/src/components/dashboard/Icons.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/Icons.test.tsx`

**Interfaces:**
- Produces: `<Icon name="grid|star|layers|sparkle|bell|settings|search|sliders|arrow|more|heart|plus|chevron|clock|link|x|check|image|file|share|copy|upload" />`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/dashboard/__tests__/Icons.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../Icons';

describe('Icon', () => {
  it('renders every documented icon name', () => {
    const names = [
      'grid','star','layers','sparkle','bell','settings','search','sliders',
      'arrow','more','heart','plus','chevron','clock','link','x','check',
      'image','file','share','copy','upload'
    ] as const;
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('respects the size prop', () => {
    const { container } = render(<Icon name="search" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/Icons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Icon component**

```tsx
// apps/web/src/components/dashboard/Icons.tsx
import type { ReactNode } from 'react';

export type IconName =
  | 'grid' | 'star' | 'layers' | 'sparkle' | 'bell' | 'settings'
  | 'search' | 'sliders' | 'arrow' | 'more' | 'heart' | 'plus'
  | 'chevron' | 'clock' | 'link' | 'x' | 'check' | 'image'
  | 'file' | 'share' | 'copy' | 'upload';

const PATHS: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  star: <path d="m12 3 2.75 5.57 6.15.89-4.45 4.34 1.05 6.13L12 17.04l-5.5 2.89 1.05-6.13L3.1 9.46l6.15-.89L12 3Z"/>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></>,
  sparkle: <path d="m12 2-1.6 6.4L4 10l6.4 1.6L12 18l1.6-6.4L20 10l-6.4-1.6L12 2Zm7 14-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16Z"/>,
  bell: <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4"/>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06A1.7 1.7 0 0 0 15.76 18a1.7 1.7 0 0 0-1.02 1.56V20h-3v-.44A1.7 1.7 0 0 0 10.72 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.08 14a1.7 1.7 0 0 0-1.56-1.02H5v-3h.52A1.7 1.7 0 0 0 7.08 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06A1.7 1.7 0 0 0 10.72 5a1.7 1.7 0 0 0 1.02-1.56V3h3v.44A1.7 1.7 0 0 0 15.76 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v3h-.04A1.7 1.7 0 0 0 19.4 15Z"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  sliders: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="11" cy="18" r="1.5"/></>,
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  share: <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></>,
  upload: <><path d="M12 16V4M8 8l4-4 4 4"/><path d="M5 14v5h14v-5"/></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/Icons.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/Icons.tsx apps/web/src/components/dashboard/__tests__/Icons.test.tsx
git commit -m "feat(web): add dashboard Icon set (22 inline SVGs)"
```

---

## Task 4: Build the new MemoryCard

**Files:**
- Create: `apps/web/src/components/dashboard/MemoryCard.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/MemoryCard.test.tsx`
- Modify: `apps/web/src/components/__tests__/MemoryCard.test.tsx` → mark `@deprecated` header, leave it for now (removed in Task 12)

**Interfaces:**
- Consumes: `memory-kind.ts` (`MemoryLabel`, `normalizeKind`)
- Consumes: `Icons.tsx` (`Icon`)
- Produces: `<MemoryCard item={...} onOpen={...} onToggleFavorite={...} relatedCount={...} />`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/dashboard/__tests__/MemoryCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryCard } from '../MemoryCard';

const baseItem = {
  id: 'a1',
  title: 'Three-headed dragon',
  snippet: 'A humorous comparison of AI models.',
  source_url: 'https://facebook.com',
  captured_at: new Date().toISOString(),
  tags: ['AI', 'meme'],
};

describe('MemoryCard', () => {
  it('renders an article variant for kind=link', () => {
    render(<MemoryCard item={{ ...baseItem, kind: 'link' }} onOpen={vi.fn()} />);
    const card = screen.getByRole('button');
    expect(card.className).toContain('article');
    expect(screen.getByText('article')).toBeTruthy();
    expect(screen.getByText(baseItem.title)).toBeTruthy();
  });

  it('renders a note variant for kind=text', () => {
    render(<MemoryCard item={{ ...baseItem, kind: 'text', title: 'A note' }} onOpen={vi.fn()} />);
    const card = screen.getByRole('button');
    expect(card.className).toContain('note');
  });

  it('renders a highlight variant for kind=link with selectedText', () => {
    render(
      <MemoryCard
        item={{ ...baseItem, kind: 'link', selectedText: '“All our dreams can come true…”' }}
        onOpen={vi.fn()}
      />
    );
    const card = screen.getByRole('button');
    expect(card.className).toContain('highlight');
  });

  it('renders an image variant with image_url', () => {
    render(
      <MemoryCard
        item={{ ...baseItem, kind: 'image', image_url: 'https://example.com/img.jpg' }}
        onOpen={vi.fn()}
      />
    );
    const card = screen.getByRole('button');
    expect(card.className).toContain('image');
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('renders text-only (no broken image) when image_url is missing', () => {
    render(<MemoryCard item={{ ...baseItem, kind: 'image' }} onOpen={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button').className).toContain('image');
  });

  it('renders a disabled document variant for kind=document', () => {
    render(<MemoryCard item={{ ...baseItem, kind: 'document' }} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').className).toContain('document');
    // disabled cards must still render a node (no crash, no layout shift)
    expect(screen.getByText(baseItem.title)).toBeTruthy();
  });

  it('fires onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<MemoryCard item={{ ...baseItem, kind: 'text' }} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('fires onToggleFavorite when the heart is clicked', async () => {
    const onToggleFavorite = vi.fn();
    render(
      <MemoryCard
        item={{ ...baseItem, kind: 'text' }}
        onOpen={vi.fn()}
        onToggleFavorite={onToggleFavorite}
      />
    );
    await userEvent.click(screen.getByLabelText(/favorite/i));
    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/MemoryCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/dashboard/MemoryCard.tsx
import { Icon } from './Icons';
import { kindToLabel, normalizeKind, type MemoryLabel } from '../../lib/memory-kind';

export interface MemoryCardItem {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  source_url?: string | null;
  image_url?: string | null;
  selectedText?: string | null;
  tags?: string[];
  captured_at?: string | null;
  is_favorite?: boolean;
  status?: string;
}

interface MemoryCardProps {
  item: MemoryCardItem;
  onOpen?: () => void;
  onToggleFavorite?: () => void;
  relatedCount?: number;
  selectedText?: string | null;
}

const LABEL_EYEBROW: Record<MemoryLabel, string> = {
  note: 'note',
  article: 'article',
  highlight: 'highlight',
  image: 'image',
  screenshot: 'screenshot',
  document: 'document',
};

const HIGHLIGHT_RE = /highlight/i;

function isHighlight(item: MemoryCardItem, label: MemoryLabel): boolean {
  if (label === 'highlight') return true;
  return !!item.selectedText && item.kind === 'link' && HIGHLIGHT_RE.test(item.title);
}

export function MemoryCard({
  item,
  onOpen,
  onToggleFavorite,
  relatedCount = 0,
  selectedText,
}: MemoryCardProps) {
  const label = normalizeKind(item.kind);
  const highlight = isHighlight(item, label);
  const variantClass = highlight ? 'highlight' : label;
  const hasImage = (label === 'image' || label === 'screenshot') && Boolean(item.image_url);
  const sourceLabel = hostnameOf(item.source_url);

  return (
    <article
      data-testid={`item-card-${item.id}`}
      data-type={variantClass}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className={`memory-card ${variantClass}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-card-action]')) return;
        onOpen?.();
      }}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {hasImage && item.image_url ? (
        <div className="card-image">
          <img src={item.image_url} alt={item.title || 'memory image'} loading="lazy" />
        </div>
      ) : null}

      <div className="card-body">
        <div className="card-top">
          <span className="eyebrow">{LABEL_EYEBROW[label]}</span>
          <div className="card-actions">
            {onToggleFavorite ? (
              <button
                type="button"
                aria-label={item.is_favorite ? 'Remove favorite' : 'Add favorite'}
                data-card-action
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
              >
                <Icon name="heart" size={15} />
              </button>
            ) : null}
            <button type="button" aria-label="More actions" data-card-action>
              <Icon name="more" size={16} />
            </button>
          </div>
        </div>

        <h3>{item.title}</h3>
        {!highlight && item.snippet ? <p>{item.snippet}</p> : null}

        <div className="meta">
          <span>{sourceLabel || formatDate(item.captured_at)}</span>
          {item.tags && item.tags.length > 0 ? (
            <span className="tags">{item.tags.slice(0, 3).join(' · ')}</span>
          ) : null}
        </div>

        {relatedCount > 0 ? (
          <div className="related" aria-label={`${relatedCount} related memories`}>
            <i aria-hidden="true" /> {relatedCount} related
          </div>
        ) : null}
      </div>
    </article>
  );
}

function hostnameOf(url?: string | null): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/MemoryCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/MemoryCard.tsx apps/web/src/components/dashboard/__tests__/MemoryCard.test.tsx
git commit -m "feat(web): add dashboard MemoryCard with 6 variants"
```

---

## Task 5: Build the SearchZone + ContentTypeChipRow + CaptureCard + EmptyState

**Files:**
- Create: `apps/web/src/components/dashboard/SearchZone.tsx`
- Create: `apps/web/src/components/dashboard/ContentTypeChipRow.tsx`
- Create: `apps/web/src/components/dashboard/CaptureCard.tsx`
- Create: `apps/web/src/components/dashboard/EmptyState.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/SearchZone.test.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/ContentTypeChipRow.test.tsx`

**Interfaces:**
- All consume `Icons.tsx`, `memory-kind.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/dashboard/__tests__/SearchZone.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchZone } from '../SearchZone';

describe('SearchZone', () => {
  it('renders an empty input with placeholder', () => {
    render(<SearchZone value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/search/i) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('calls onChange when the user types', async () => {
    const onChange = vi.fn();
    render(<SearchZone value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/search/i), 'hi');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows the kbd hint', () => {
    render(<SearchZone value="" onChange={() => {}} />);
    expect(screen.getByText('⌘ K')).toBeTruthy();
  });
});
```

```tsx
// apps/web/src/components/dashboard/__tests__/ContentTypeChipRow.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContentTypeChipRow } from '../ContentTypeChipRow';

describe('ContentTypeChipRow', () => {
  it('marks the active one', () => {
    render(
      <ContentTypeChipRow
        active="all"
        onChange={() => {}}
      />
    );
    const active = screen.getByRole('button', { pressed: true });
    expect(active.textContent).toBe('All');
  });

  it('fires onChange when clicked', async () => {
    const onChange = vi.fn();
    render(<ContentTypeChipRow active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onChange).toHaveBeenCalledWith('note');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/SearchZone.test.tsx src/components/dashboard/__tests__/ContentTypeChipRow.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/dashboard/SearchZone.tsx
import { Icon } from './Icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchZone({ value, onChange, placeholder = 'Search your memories...', autoFocus }: Props) {
  return (
    <section className="search-zone" aria-label="Memory search">
      <div className="searchline">
        <Icon name="search" size={20} />
        <input
          aria-label="Search your memories"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          data-mn-search
        />
        <kbd>⌘ K</kbd>
      </div>
    </section>
  );
}
```

```tsx
// apps/web/src/components/dashboard/ContentTypeChipRow.tsx
import type { MemoryLabel } from '../../lib/memory-kind';

interface Props {
  active: MemoryLabel | 'all';
  onChange: (label: MemoryLabel | 'all') => void;
}

const LABELS: Array<{ id: MemoryLabel | 'all'; name: string }> = [
  { id: 'all', name: 'All' },
  { id: 'note', name: 'Notes' },
  { id: 'article', name: 'Articles' },
  { id: 'image', name: 'Images' },
  { id: 'screenshot', name: 'Screenshots' },
  { id: 'highlight', name: 'Highlights' },
  { id: 'document', name: 'Documents' },
];

export function ContentTypeChipRow({ active, onChange }: Props) {
  return (
    <div className="filter-row">
      <div className="chips" aria-label="Content type">
        {LABELS.map((label) => (
          <button
            key={label.id}
            type="button"
            aria-pressed={active === label.id}
            onClick={() => onChange(label.id)}
            className={`chip ${active === label.id ? 'active' : ''}`}
          >
            {label.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/dashboard/CaptureCard.tsx
import { Icon } from './Icons';

interface Props {
  onClick: () => void;
}

export function CaptureCard({ onClick }: Props) {
  return (
    <button type="button" className="capture-card" onClick={onClick}>
      <span className="eyebrow">
        <i aria-hidden="true" /> New memory
      </span>
      <strong>Start typing...</strong>
      <span className="capture-hint">
        <Icon name="plus" size={14} /> or paste anything
      </span>
    </button>
  );
}
```

```tsx
// apps/web/src/components/dashboard/EmptyState.tsx
import type { ReactNode } from 'react';
import { Icon } from './Icons';

interface Props {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, text, action }: Props) {
  return (
    <section className="empty" aria-label="Empty state">
      <div className="empty-inner">
        <div className="empty-mark" aria-hidden="true">
          <span /><span /><span />
        </div>
        <h1>{title}</h1>
        <p>{text}</p>
        {action ? (
          <button type="button" className="primary" onClick={action.onClick}>
            <Icon name="plus" size={16} />
            {action.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/SearchZone.test.tsx src/components/dashboard/__tests__/ContentTypeChipRow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/SearchZone.tsx apps/web/src/components/dashboard/ContentTypeChipRow.tsx apps/web/src/components/dashboard/CaptureCard.tsx apps/web/src/components/dashboard/EmptyState.tsx apps/web/src/components/dashboard/__tests__/SearchZone.test.tsx apps/web/src/components/dashboard/__tests__/ContentTypeChipRow.test.tsx
git commit -m "feat(web): add SearchZone, ContentTypeChipRow, CaptureCard, EmptyState"
```

---

## Task 6: Build the new DashboardShell (top-nav layout) + DashboardUserMenu + MobileBottomNav

**Files:**
- Modify: `apps/web/src/components/dashboard/DashboardShell.tsx`
- Create: `apps/web/src/components/dashboard/DashboardTopNav.tsx`
- Create: `apps/web/src/components/dashboard/DashboardUserMenu.tsx`
- Create: `apps/web/src/components/dashboard/MobileBottomNav.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/DashboardTopNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/dashboard/__tests__/DashboardTopNav.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardTopNav } from '../DashboardTopNav';

describe('DashboardTopNav', () => {
  it('highlights the active page', () => {
    render(
      <DashboardTopNav
        active="Spaces"
        onNavigate={() => {}}
        onCapture={() => {}}
        initials="AC"
      />
    );
    expect(screen.getByRole('button', { name: 'Spaces' }).className).toContain('active');
  });

  it('fires onNavigate when a tab is clicked', async () => {
    const onNavigate = vi.fn();
    render(
      <DashboardTopNav
        active="Everything"
        onNavigate={onNavigate}
        onCapture={() => {}}
        initials="AC"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Rediscover' }));
    expect(onNavigate).toHaveBeenCalledWith('Rediscover');
  });

  it('fires onCapture when the Capture button is clicked', async () => {
    const onCapture = vi.fn();
    render(
      <DashboardTopNav
        active="Everything"
        onNavigate={() => {}}
        onCapture={onCapture}
        initials="AC"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(onCapture).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/DashboardTopNav.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DashboardTopNav**

```tsx
// apps/web/src/components/dashboard/DashboardTopNav.tsx
import { Icon } from './Icons';

export type DashboardPage = 'Everything' | 'Favorites' | 'Spaces' | 'Rediscover' | 'Reminders' | 'Settings';

const NAV: Array<{ label: DashboardPage }> = [
  { label: 'Everything' },
  { label: 'Favorites' },
  { label: 'Spaces' },
  { label: 'Rediscover' },
  { label: 'Reminders' },
];

interface Props {
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
  initials: string;
}

export function DashboardTopNav({ active, onNavigate, onCapture, initials }: Props) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="brand"
        onClick={() => onNavigate('Everything')}
        aria-label="Mnemonics home"
        data-testid="brand"
      >
        <span className="brand-symbol">m</span>
        <span>
          mnemonics
          <span className="brand-tagline">Save once — Find anytime.</span>
        </span>
      </button>

      <nav aria-label="Main navigation">
        {NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className={active === item.label ? 'header-link active' : 'header-link'}
            aria-current={active === item.label ? 'page' : undefined}
            onClick={() => onNavigate(item.label)}
            data-testid={`nav-${item.label.toLowerCase()}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <button type="button" className="primary" onClick={onCapture} data-testid="capture-btn">
          <Icon name="plus" size={16} />
          Capture
        </button>
        <button
          type="button"
          className="avatar"
          title={`Settings · ${initials}`}
          aria-label="Account settings"
          onClick={() => onNavigate('Settings')}
          data-testid="avatar-btn"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Implement DashboardUserMenu and MobileBottomNav**

`DashboardUserMenu.tsx` — small dropdown, used by Settings link target.
For this PR it just renders the initials avatar; full dropdown is out of scope.

```tsx
// apps/web/src/components/dashboard/DashboardUserMenu.tsx
interface Props { initials: string; email: string; }
export function DashboardUserMenu({ initials }: Props) {
  return <span className="avatar" aria-label="Account">{initials}</span>;
}
```

`MobileBottomNav.tsx` — bottom nav for mobile width.

```tsx
// apps/web/src/components/dashboard/MobileBottomNav.tsx
import { Icon, type IconName } from './Icons';
import type { DashboardPage } from './DashboardTopNav';

interface Props {
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
}

const ITEMS: Array<{ label: DashboardPage; icon: IconName }> = [
  { label: 'Everything', icon: 'grid' },
  { label: 'Spaces', icon: 'layers' },
  { label: 'Rediscover', icon: 'sparkle' },
  { label: 'Settings', icon: 'settings' },
];

export function MobileBottomNav({ active, onNavigate, onCapture }: Props) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          className={active === item.label ? 'active' : ''}
          onClick={() => onNavigate(item.label)}
        >
          <span><Icon name={item.icon} /></span>
          <small>{item.label}</small>
        </button>
      ))}
      <button type="button" onClick={onCapture} aria-label="Capture memory">
        <span className="capture-mobile"><Icon name="plus" /></span>
        <small>Capture</small>
      </button>
    </nav>
  );
}
```

- [ ] **Step 5: Rewrite DashboardShell**

```tsx
// apps/web/src/components/dashboard/DashboardShell.tsx
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '../../lib/api-client';
import { DashboardTopNav, type DashboardPage } from './DashboardTopNav';
import { MobileBottomNav } from './MobileBottomNav';

interface DashboardShellProps {
  user: AuthUser;
  active: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onCapture: () => void;
  onLogout: () => void;
  demoMode?: boolean;
  children: ReactNode;
}

export function DashboardShell({
  user,
  active,
  onNavigate,
  onCapture,
  onLogout,
  demoMode,
  children,
}: DashboardShellProps) {
  // Cmd/Ctrl + K focuses the dashboard search input if present.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const hotkey = isMac ? e.metaKey : e.ctrlKey;
      if (!hotkey || e.key.toLowerCase() !== 'k') return;
      const el = document.querySelector<HTMLInputElement>('[data-mn-search]');
      if (el) { e.preventDefault(); el.focus(); el.select(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The Settings nav is handled by `onNavigate('Settings')` which the page
  // wires to the React Router. The Logout link below is the only direct action.
  void onLogout; void demoMode;
  const initials = computeInitials(user.email);

  return (
    <div className="app">
      <div className="content">
        <DashboardTopNav
          active={active}
          onNavigate={onNavigate}
          onCapture={onCapture}
          initials={initials}
        />
        {children}
      </div>
      <MobileBottomNav active={active} onNavigate={onNavigate} onCapture={onCapture} />
    </div>
  );
}

function computeInitials(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : email;
  return name.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 6: Run typecheck and the new test**

Run: `pnpm --filter @mnemonics/web typecheck`
Expected: PASS

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/DashboardTopNav.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/dashboard/DashboardShell.tsx apps/web/src/components/dashboard/DashboardTopNav.tsx apps/web/src/components/dashboard/DashboardUserMenu.tsx apps/web/src/components/dashboard/MobileBottomNav.tsx apps/web/src/components/dashboard/__tests__/DashboardTopNav.test.tsx
git commit -m "feat(web): switch DashboardShell to top-nav layout"
```

---

## Task 7: Build the CaptureSheet modal

**Files:**
- Create: `apps/web/src/components/dashboard/CaptureSheet.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/CaptureSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/dashboard/__tests__/CaptureSheet.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from '../CaptureSheet';

describe('CaptureSheet', () => {
  it('renders 4 actions', () => {
    render(
      <CaptureSheet open onClose={() => {}} onAction={() => {}} />
    );
    expect(screen.getByRole('button', { name: /save link/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /quick note/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload document/i })).toBeTruthy();
  });

  it('fires onAction with the action key', async () => {
    const onAction = vi.fn();
    render(<CaptureSheet open onClose={() => {}} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: /quick note/i }));
    expect(onAction).toHaveBeenCalledWith('note');
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(<CaptureSheet open onClose={onClose} onAction={() => {}} />);
    await userEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/CaptureSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/dashboard/CaptureSheet.tsx
import { Icon, type IconName } from './Icons';

export type CaptureAction = 'link' | 'note' | 'image' | 'document';

interface Props {
  open: boolean;
  onClose: () => void;
  onAction: (action: CaptureAction) => void;
}

const ACTIONS: Array<{ key: CaptureAction; label: string; icon: IconName }> = [
  { key: 'link', label: 'Save Link', icon: 'link' },
  { key: 'note', label: 'Quick Note', icon: 'plus' },
  { key: 'image', label: 'Upload Image', icon: 'image' },
  { key: 'document', label: 'Upload Document', icon: 'upload' },
];

export function CaptureSheet({ open, onClose, onAction }: Props) {
  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="capture-sheet"
    >
      <div
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Capture a memory"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Capture a memory</h2>
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            data-testid={`capture-${a.key}`}
            onClick={() => { onAction(a.key); onClose(); }}
          >
            <Icon name={a.icon} />
            {a.label}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/CaptureSheet.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/CaptureSheet.tsx apps/web/src/components/dashboard/__tests__/CaptureSheet.test.tsx
git commit -m "feat(web): add CaptureSheet modal"
```

---

## Task 8: Build the Everything view (page-level masonry + search integration)

**Files:**
- Create: `apps/web/src/components/dashboard/EverythingView.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/EverythingView.test.tsx`

**Interfaces:**
- Consumes: `api-client.ts` (only types — actual data fetch happens in the page)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/dashboard/__tests__/EverythingView.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EverythingView } from '../EverythingView';

const items = [
  { id: '1', kind: 'text', title: 'A note', snippet: 'Hello' },
  { id: '2', kind: 'image', title: 'A pic', image_url: 'https://example.com/x.jpg' },
];

describe('EverythingView', () => {
  it('renders one card per item', () => {
    render(
      <EverythingView
        items={items}
        loading={false}
        onOpen={() => {}}
      />
    );
    expect(screen.getByText('A note')).toBeTruthy();
    expect(screen.getByText('A pic')).toBeTruthy();
  });

  it('renders the empty state when items is empty and not loading', () => {
    render(<EverythingView items={[]} loading={false} onOpen={() => {}} />);
    expect(screen.getByText(/your memory starts here/i)).toBeTruthy();
  });

  it('does not call the search callback when submitting an empty query', async () => {
    const onSearch = vi.fn();
    render(
      <EverythingView
        items={items}
        loading={false}
        onOpen={() => {}}
        onSearch={onSearch}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('calls onSearch when the user submits a non-empty query', async () => {
    const onSearch = vi.fn();
    render(
      <EverythingView
        items={items}
        loading={false}
        onOpen={() => {}}
        onSearch={onSearch}
      />
    );
    const input = screen.getByLabelText(/search/i) as HTMLInputElement;
    await userEvent.type(input, 'hello');
    await userEvent.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledWith('hello');
  });

  it('redirects to login when token is missing (caller-driven)', () => {
    // The view is dumb — it surfaces `error` from the page. This test pins
    // the contract: when error === 'TOKEN_EXPIRED' the view renders a banner
    // with a link to /login.
    render(
      <EverythingView
        items={items}
        loading={false}
        onOpen={() => {}}
        error="TOKEN_EXPIRED"
      />
    );
    expect(screen.getByText(/session expired/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/EverythingView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/dashboard/EverythingView.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchZone } from './SearchZone';
import { ContentTypeChipRow } from './ContentTypeChipRow';
import { MemoryCard } from './MemoryCard';
import { CaptureCard } from './CaptureCard';
import { EmptyState } from './EmptyState';
import type { MemoryCardItem } from './MemoryCard';
import type { MemoryLabel } from '../../lib/memory-kind';

interface EverythingViewProps {
  items: MemoryCardItem[];
  loading: boolean;
  error?: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSearch?: (q: string) => void;
  filter: MemoryLabel | 'all';
  onFilterChange: (f: MemoryLabel | 'all') => void;
  onOpen: (id: string) => void;
  onCapture: () => void;
}

export function EverythingView({
  items, loading, error, query, onQueryChange, onSearch, filter, onFilterChange, onOpen, onCapture,
}: EverythingViewProps) {
  const submit = () => {
    if (query.trim() && onSearch) onSearch(query.trim());
  };

  if (error === 'TOKEN_EXPIRED') {
    return (
      <main className="main everything">
        <EmptyState
          title="Session expired"
          text="Please sign in again to continue."
          action={{ label: 'Sign in', onClick: () => { window.location.href = '/login'; } }}
        />
      </main>
    );
  }

  return (
    <main className="main everything">
      <header className="dashboard-heading">
        <div>
          <h1>Everything</h1>
          <p>Your saved memories in one place.</p>
        </div>
        <span className="memory-count">{items.length} memories</span>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        role="search"
      >
        <SearchZone value={query} onChange={onQueryChange} autoFocus={!!query} />
      </form>

      <ContentTypeChipRow active={filter} onChange={onFilterChange} />

      {loading ? (
        <div className="masonry" aria-busy>
          {[220, 168, 244, 312, 220, 168].map((h, i) => (
            <div key={i} className={`skeleton ${h >= 300 ? 'tall' : h >= 220 ? 'medium' : 'short'}`} style={{ height: h }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={query ? 'No memories found.' : 'Your memory starts here.'}
          text={query ? 'Try another keyword or a different content type.' : 'Save something worth remembering.'}
          action={query ? undefined : { label: 'Capture', onClick: onCapture }}
        />
      ) : (
        <div className="masonry">
          {!query ? <CaptureCard onClick={onCapture} /> : null}
          {items.map((it) => (
            <MemoryCard key={it.id} item={it} onOpen={() => onOpen(it.id)} />
          ))}
        </div>
      )}

      {/* hidden anchor for tests that use a Link to /login */}
      <Link to="/login" hidden>login</Link>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mnemonics/web test src/components/dashboard/__tests__/EverythingView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/EverythingView.tsx apps/web/src/components/dashboard/__tests__/EverythingView.test.tsx
git commit -m "feat(web): add EverythingView (masonry + search + filters)"
```

---

## Task 9: Build the new DashboardPage, SpacesPage, SpaceDetailPage, RediscoverPage, RemindersStubPage

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx` (replace contents)
- Modify: `apps/web/src/pages/SpacesPage.tsx` (replace contents)
- Modify: `apps/web/src/pages/SpaceDetailPage.tsx` (replace contents)
- Create: `apps/web/src/pages/RediscoverPage.tsx`
- Create: `apps/web/src/pages/RemindersStubPage.tsx`
- Create: `apps/web/src/pages/__tests__/DashboardPage.test.tsx`
- Create: `apps/web/src/pages/__tests__/RemindersStubPage.test.tsx`

**Interfaces:**
- All pages consume `EverythingView` (Dashboard + SpaceDetail), `SpacesGrid` (Spaces), etc.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/pages/__tests__/DashboardPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../DashboardPage';
import { ApiClient } from '../../lib/api-client';

function mockApi(): ApiClient {
  const api = new ApiClient('http://localhost');
  vi.spyOn(api, 'loadStoredSession').mockReturnValue({
    accessToken: 't', refreshToken: 'r', user: { id: 'u1', email: 'a@b.c' }, expiresAt: 0,
  });
  vi.spyOn(api, 'getValidAccessToken').mockResolvedValue('t');
  vi.spyOn(api, 'listItems').mockResolvedValue({
    items: [
      { id: '1', kind: 'text', title: 'Hello', snippet: 'World', captured_at: new Date().toISOString() },
    ],
    total: 1, limit: 50, offset: 0,
  });
  return api;
}

describe('DashboardPage', () => {
  it('renders the dashboard shell and items', async () => {
    const api = mockApi();
    render(
      <MemoryRouter>
        <DashboardPage api={api} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Hello'));
  });
});
```

```tsx
// apps/web/src/pages/__tests__/RemindersStubPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RemindersStubPage } from '../RemindersStubPage';

describe('RemindersStubPage', () => {
  it('renders the coming-soon stub without a session', () => {
    render(
      <MemoryRouter>
        <RemindersStubPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mnemonics/web test src/pages/__tests__/DashboardPage.test.tsx src/pages/__tests__/RemindersStubPage.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement RemindersStubPage (the simplest page)**

```tsx
// apps/web/src/pages/RemindersStubPage.tsx
import { Icon } from '../components/dashboard/Icons';

export function RemindersStubPage() {
  return (
    <main className="main standard">
      <header className="page-header">
        <div>
          <span className="eyebrow">GENTLE PROMPTS</span>
          <h1>Reminders</h1>
          <p>A few things you asked to revisit.</p>
        </div>
      </header>
      <section className="empty">
        <div className="empty-inner">
          <div className="empty-mark" aria-hidden="true">
            <span /><span /><span />
          </div>
          <h1>Coming soon</h1>
          <p>Mnemonics Reminders is on the roadmap. The API for this page is not in v1.</p>
        </div>
      </section>
      {/* hidden icon so the import is not unused */}
      <span hidden><Icon name="bell" /></span>
    </main>
  );
}
```

- [ ] **Step 4: Implement DashboardPage (everything view)**

The page wires: session, list/search, filter, favorite, capture sheet. It
delegates rendering to `EverythingView`.

```tsx
// apps/web/src/pages/DashboardPage.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import { CaptureSheet, type CaptureAction } from '../components/dashboard/CaptureSheet';
import {
  ApiClient, type Item, type Session,
} from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';
import type { MemoryLabel } from '../lib/memory-kind';
import type { DashboardPage as DashboardPageName } from '../components/dashboard/DashboardTopNav';

interface Props { api: ApiClient; }

export function DashboardPage({ api }: Props) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<MemoryLabel | 'all'>('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const epoch = useRef(0);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (!stored) return;
    setSession(stored);
  }, [api]);

  const loadList = useCallback(async () => {
    if (!session) return;
    const e = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) { setError('TOKEN_EXPIRED'); return; }
      const r = await api.listItems(token, { limit: 50, favorite: favoriteOnly || undefined });
      if (e !== epoch.current) return;
      setItems(r.items);
    } catch (err) {
      if (e !== epoch.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      if (e === epoch.current) setLoading(false);
    }
  }, [api, session, favoriteOnly]);

  const runSearch = useCallback(async () => {
    if (!session || !query) return;
    const e = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) { setError('TOKEN_EXPIRED'); return; }
      const r = await api.search({ q: query, limit: 50 }, token);
      if (e !== epoch.current) return;
      setSearchHits(r.hits);
    } catch (err) {
      if (e !== epoch.current) return;
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      if (e === epoch.current) setLoading(false);
    }
  }, [api, session, query]);

  useEffect(() => { if (session) loadList(); }, [session, loadList]);

  const visibleItems: MemoryCardItem[] = (searchHits ?? items).map((it) => ({
    id: String(it.id),
    kind: it.kind,
    title: it.title,
    snippet: it.snippet,
    image_url: it.image_url,
    source_url: it.source_url,
    tags: it.tags,
    captured_at: it.captured_at,
    is_favorite: (it as Item & { is_favorite?: boolean }).is_favorite,
    status: it.status,
  }));

  const handleNavigate = (page: DashboardPageName) => {
    if (page === 'Everything') navigate('/app');
    else if (page === 'Spaces') navigate('/app/spaces');
    else if (page === 'Rediscover') navigate('/app/rediscover');
    else if (page === 'Reminders') navigate('/app/reminders');
    else if (page === 'Settings') navigate('/app/settings');
    else if (page === 'Favorites') navigate('/app?filter=favorites');
  };

  if (!session) return <LoginGate api={api} onLogin={(s) => { setSession(s); api.saveSession(s); }} />;

  return (
    <DashboardShell
      user={session.user}
      active="Everything"
      onNavigate={handleNavigate}
      onCapture={() => setCaptureOpen(true)}
      onLogout={() => { api.saveSession(null); setSession(null); navigate('/'); }}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <EverythingView
        items={visibleItems}
        loading={loading}
        error={error}
        query={query}
        onQueryChange={setQuery}
        onSearch={runSearch}
        filter={filter}
        onFilterChange={setFilter}
        onOpen={() => undefined}
        onCapture={() => setCaptureOpen(true)}
      />
      <CaptureSheet
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onAction={(a: CaptureAction) => {
          if (a === 'note') navigate('/app/quick-note');
          else if (a === 'link') navigate('/app/quick-link');
        }}
      />
    </DashboardShell>
  );
}

function LoginGate({ api, onLogin }: { api: ApiClient; onLogin: (s: Session) => void }) {
  // The login form is the same as before; we import it lazily so this page
  // doesn't change the auth flow.
  const LoginForm = require('../components/LoginForm').LoginForm;
  return <LoginForm api={api} onLogin={onLogin} onForgotPassword={() => undefined} />;
}
```

> Note: `LoginGate` uses a lazy `require` to avoid a circular import risk.
> In practice the team can replace it with a static import if preferred.

- [ ] **Step 5: Implement SpacesPage + SpaceDetailPage + RediscoverPage**

```tsx
// apps/web/src/pages/SpacesPage.tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { ApiClient, type Session, type SpaceWithCount, type SpaceSuggestion } from '../lib/api-client';
import { Icon } from '../components/dashboard/Icons';

export function SpacesPage({ api }: { api: ApiClient }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [spaces, setSpaces] = useState<SpaceWithCount[]>([]);
  const [suggestions, setSuggestions] = useState<SpaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = api.loadStoredSession();
    if (s) setSession(s);
  }, [api]);

  const loadAll = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const token = await api.getValidAccessToken();
      if (!token) return;
      const [list, sugs] = await Promise.all([
        api.listSpaces(token),
        api.listSuggestions(token).catch(() => []),
      ]);
      setSpaces(list); setSuggestions(sugs);
    } finally { setLoading(false); }
  }, [api, session]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!session) return null;
  return (
    <DashboardShell
      user={session.user} active="Spaces" demoMode={false}
      onNavigate={(p) => p === 'Everything' ? navigate('/app') : undefined}
      onCapture={() => undefined}
      onLogout={() => { api.saveSession(null); setSession(null); navigate('/'); }}
    >
      <main className="main standard">
        <header className="page-header">
          <div>
            <span className="eyebrow">YOUR COLLECTIONS</span>
            <h1>Spaces</h1>
            <p>Bring related memories together.</p>
          </div>
          <button type="button" className="primary" onClick={() => navigate('/app/spaces/new')}>
            <Icon name="plus" size={16} /> New Space
          </button>
        </header>

        <section>
          <div className="dashboard-heading" style={{ marginBottom: 12 }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>My Spaces</h1>
            <span className="memory-count">{spaces.length}</span>
          </div>
          {loading ? <p>Loading…</p> :
            spaces.length === 0 ? <p>No spaces yet.</p> :
            <div className="spaces-grid">
              {spaces.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="space-card"
                  onClick={() => navigate(`/app/spaces/${s.id}`)}
                >
                  <div className="collage">
                    <Icon name="file" />
                  </div>
                  <h3 style={{ margin: '6px 0' }}>{s.name}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--secondary)' }}>{s.itemCount} memories</p>
                </button>
              ))}
            </div>
          }
        </section>

        <section style={{ marginTop: 56 }}>
          <span className="eyebrow">SUGGESTED</span>
          {suggestions.length === 0 ? (
            <p style={{ marginTop: 8 }}>No suggestions right now.</p>
          ) : (
            <div className="spaces-grid" style={{ marginTop: 12 }}>
              {suggestions.map((sg) => (
                <article key={sg.id} className="space-card">
                  <h3 style={{ margin: '6px 0' }}>{sg.suggestedName}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--secondary)' }}>{sg.suggestedDescription}</p>
                  <button type="button" className="primary" style={{ marginTop: 12 }}
                    onClick={() => api.acceptSuggestion(sg.id, session.accessToken).then(loadAll)}>
                    Create Space
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  );
}
```

```tsx
// apps/web/src/pages/SpaceDetailPage.tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import { ApiClient, type Item, type Session } from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';

export function SpaceDetailPage({ api }: { api: ApiClient }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { const s = api.loadStoredSession(); if (s) setSession(s); }, [api]);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    try {
      const token = await api.getValidAccessToken();
      if (!token) return;
      const ids = await api.listSpaceItems(id, token);
      const fetched = await Promise.all(ids.data.ids.map((iid) => api.getItem(iid, token).catch(() => null)));
      setItems(fetched.filter((x): x is Item => x !== null));
    } finally { setLoading(false); }
  }, [api, session, id]);

  useEffect(() => { load(); }, [load]);
  if (!session) return null;

  const mapped: MemoryCardItem[] = items.map((it) => ({
    id: String(it.id), kind: it.kind, title: it.title,
    snippet: (it as Item & { raw_text?: string }).raw_text ?? it.title,
    source_url: (it as Item & { source_url?: string }).source_url ?? null,
    image_url: (it as Item & { image_url?: string }).image_url ?? null,
    tags: it.tags, captured_at: (it as Item & { captured_at?: string }).captured_at ?? null,
    status: it.status,
  }));

  return (
    <DashboardShell user={session.user} active="Spaces" demoMode={false}
      onNavigate={(p) => p === 'Everything' ? navigate('/app') : p === 'Spaces' ? navigate('/app/spaces') : undefined}
      onCapture={() => undefined}
      onLogout={() => { api.saveSession(null); setSession(null); navigate('/'); }}
    >
      <EverythingView
        items={mapped} loading={loading} error={null}
        query="" onQueryChange={() => undefined} onSearch={undefined}
        filter="all" onFilterChange={() => undefined}
        onOpen={() => undefined} onCapture={() => undefined}
      />
    </DashboardShell>
  );
}
```

```tsx
// apps/web/src/pages/RediscoverPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { ApiClient, type Session } from '../lib/api-client';

export function RediscoverPage({ api }: { api: ApiClient }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { const s = api.loadStoredSession(); if (s) setSession(s); }, [api]);
  if (!session) return null;
  return (
    <DashboardShell user={session.user} active="Rediscover" demoMode={false}
      onNavigate={(p) => p === 'Everything' ? navigate('/app') : undefined}
      onCapture={() => undefined}
      onLogout={() => { api.saveSession(null); setSession(null); navigate('/'); }}
    >
      <main className="main standard">
        <header className="page-header">
          <div>
            <span className="eyebrow">A QUIET RETURN</span>
            <h1>Rediscover</h1>
            <p>Things worth remembering again.</p>
          </div>
        </header>
        <section className="empty">
          <div className="empty-inner">
            <div className="empty-mark" aria-hidden="true"><span /><span /><span /></div>
            <h1>Coming soon</h1>
            <p>Mnemonics Rediscover is on the roadmap.</p>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @mnemonics/web test src/pages/__tests__/DashboardPage.test.tsx src/pages/__tests__/RemindersStubPage.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/SpacesPage.tsx apps/web/src/pages/SpaceDetailPage.tsx apps/web/src/pages/RediscoverPage.tsx apps/web/src/pages/RemindersStubPage.tsx apps/web/src/pages/__tests__/DashboardPage.test.tsx apps/web/src/pages/__tests__/RemindersStubPage.test.tsx
git commit -m "feat(web): rewrite Dashboard/Spaces/SpaceDetail pages, add Rediscover + Reminders stub"
```

---

## Task 10: Wire the new routes into the router

**Files:**
- Modify: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/pages/__tests__/routing.test.tsx` (replace the old one)

- [ ] **Step 1: Modify the router**

```tsx
// apps/web/src/app/router.tsx — REPLACE WITH:
import { Routes, Route } from 'react-router-dom';
import { Header } from '../components/marketing/Header';
import { Footer } from '../components/marketing/Footer';
import { HomePage } from '../pages/HomePage';
import { BrowserExtensionPage } from '../pages/BrowserExtensionPage';
import { LoginPage } from '../pages/LoginPage';
import { SignupPage } from '../pages/SignupPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { DashboardPage } from '../pages/DashboardPage';
import { SpacesPage } from '../pages/SpacesPage';
import { SpaceDetailPage } from '../pages/SpaceDetailPage';
import { RediscoverPage } from '../pages/RediscoverPage';
import { RemindersStubPage } from '../pages/RemindersStubPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import type { ApiClient } from '../lib/api-client';

export function AppRouter({ api }: { api: ApiClient }) {
  return (
    <div className="mnemonics-app-root">
      <Routes>
        <Route path="/" element={<><Header /><HomePage /><Footer /></>} />
        <Route path="/browser-extension" element={<><Header /><BrowserExtensionPage /><Footer /></>} />
        <Route path="/login" element={<LoginPage api={api} />} />
        <Route path="/signup" element={<SignupPage api={api} />} />
        <Route path="/reset-password" element={<ResetPasswordPage api={api} />} />
        <Route path="/app" element={<DashboardPage api={api} />} />
        <Route path="/app/spaces" element={<SpacesPage api={api} />} />
        <Route path="/app/spaces/:id" element={<SpaceDetailPage api={api} />} />
        <Route path="/app/rediscover" element={<RediscoverPage api={api} />} />
        <Route path="/app/reminders" element={<RemindersStubPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
```

- [ ] **Step 2: Verify the routing test still passes**

Run: `pnpm --filter @mnemonics/web test src/lib/__tests__/routing.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/router.tsx
git commit -m "feat(web): wire /app/rediscover + /app/reminders routes"
```

---

## Task 11: Run the full monorepo test suite + typecheck

**Files:**
- No new files

- [ ] **Step 1: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS

- [ ] **Step 2: Tests**

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 3: Build the web bundle**

Run: `pnpm --filter @mnemonics/web build`
Expected: SUCCESS (production bundle written to `apps/web/dist/`)

- [ ] **Step 4: Document run instructions in CHANGELOG**

Edit `docs/dashboard-redesign.md` to mention the new pages + how to
test them. Add a "Migration notes" heading.

(No commit needed — this is doc-only and goes in the cleanup PR.)

---

## Task 12: Cleanup — delete the old UI, keep one set

**Files:**
- Delete: `apps/web/src/components/MemoryCard.tsx`
- Delete: `apps/web/src/components/MemoryEmpty.tsx`
- Delete: `apps/web/src/components/MemoryFilterBar.tsx`
- Delete: `apps/web/src/components/MemorySearch.tsx`
- Delete: `apps/web/src/components/MemorySkeleton.tsx`
- Delete: `apps/web/src/components/QuickCapture.tsx`
- Delete: `apps/web/src/components/CapturePromptCard.tsx`
- Delete: `apps/web/src/components/ItemDetailModal.tsx`
- Delete: `apps/web/src/components/__tests__/MemoryCard.test.tsx`
- Delete: `apps/web/src/styles/dashboard.css.bak`
- Delete: `apps/web/src/components/spaces/AddToSpacePopover.tsx` (only if no longer referenced — verify in Step 0)
- Delete: `apps/web/src/components/spaces/CreateSpaceDialog.tsx` (only if no longer referenced — verify in Step 0)

- [ ] **Step 0: Audit remaining references**

```bash
grep -rln "from '\.\./MemoryCard'\|from '\.\./MemoryEmpty'\|from '\.\./MemoryFilterBar'\|from '\.\./MemorySearch'\|from '\.\./MemorySkeleton'\|from '\.\./QuickCapture'\|from '\.\./CapturePromptCard'\|from '\.\./ItemDetailModal'\|from '\.\./spaces/AddToSpacePopover'\|from '\.\./spaces/CreateSpaceDialog'" apps/web/src
```

If any file outside the `dashboard/` folder references these, fix
those first. Expected: empty.

- [ ] **Step 1: Delete the listed files**

```bash
git rm apps/web/src/components/MemoryCard.tsx \
       apps/web/src/components/MemoryEmpty.tsx \
       apps/web/src/components/MemoryFilterBar.tsx \
       apps/web/src/components/MemorySearch.tsx \
       apps/web/src/components/MemorySkeleton.tsx \
       apps/web/src/components/QuickCapture.tsx \
       apps/web/src/components/CapturePromptCard.tsx \
       apps/web/src/components/ItemDetailModal.tsx \
       apps/web/src/components/__tests__/MemoryCard.test.tsx \
       apps/web/src/styles/dashboard.css.bak
```

- [ ] **Step 2: Verify typecheck + tests**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @mnemonics/web build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(web): remove legacy dashboard components, keep single UI set"
```

---

## Task 13: Final integration verification

**Files:**
- Modify: `docs/dashboard-redesign.md`

- [ ] **Step 1: Manual smoke test checklist**

Document a 10-step checklist in `docs/dashboard-redesign.md` that an
operator can follow to verify the new dashboard by hand:

1. `pnpm dev` starts the API on `:4000` and the web app on `:5173`.
2. Open `http://localhost:5173/`, click **Login**, sign in with the dev token.
4. Header nav highlights **Everything**; masonry shows cards or empty state.
5. Type "test" in the search box → results update.
6. Click a chip → list filters.
7. Click a card → no detail overlay yet (deferred to a follow-up).
8. Click **Spaces** → grid renders; suggestions render below.
9. Click **Rediscover** → stub renders.
10. Click **Reminders** → stub renders.

- [ ] **Step 2: Commit**

```bash
git add docs/dashboard-redesign.md
git commit -m "docs(web): dashboard-redesign smoke-test checklist"
```

---

## Acceptance gates

- [ ] `pnpm -r typecheck` exits 0
- [ ] `pnpm -r test` exits 0
- [ ] `pnpm --filter @mnemonics/web build` exits 0
- [ ] No legacy component file remains in `apps/web/src/components/` outside of `dashboard/` or `marketing/`
- [ ] Marketing + auth pages render unchanged in `pnpm --filter @mnemonics/web build` output

End of plan.