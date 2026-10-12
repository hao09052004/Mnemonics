# Mnemonics — Web

> Status: **MVP**. Currently a placeholder directory. The user-facing web
> dashboard lives inside the Chrome extension at `apps/extension/mnemonics-dashboard.html`
> so that the same UI can be served both from the extension popup and from a
> standalone hosted page (via the existing `web_accessible_resources` entry
> in `apps/extension/manifest.json`).

## Why this directory exists

1. **Spec discipline.** The API contract at `specs/api/auth.md` is identical
   for both clients. A future split can move the dashboard here without
   changing the contract.
2. **Build pipeline.** Once the team needs SSR or Vite-driven bundling, the
   React app will live here and consume the same `auth-client.js` API.
3. **Local preview.** A future `pnpm --filter @mnemonics/web dev` will
   serve the same `mnemonics-dashboard.html` standalone.

## Authentication flow (today)

1. User opens `apps/extension/mnemonics-dashboard.html` from anywhere the
   extension exposes it.
2. The dashboard POSTs to `http://localhost:4000/api/v1/auth/*` (configured
   in `dashboard.js`'s `authRequest` helper) using bearer tokens issued by
   Supabase via our backend facade.
3. Tokens live in `chrome.storage.local` under `mnemonics_session` when the
   app runs as the extension, or `localStorage` if served standalone.
4. Tokens **never** leave the client bundle as URL params or query strings
   (enforced by `apps/api/src/auth/__tests__/auth-client.contract.test.ts`).

## Future work

- Move `mnemonics-dashboard.html` and `dashboard.js` here verbatim.
- Add a Vite config and React shim.
- Move `auth-client.js` to a shared `packages/frontend-auth` workspace.
