# Releasing the Mnemonics Microsoft Edge extension

Mnemonics ships **one Manifest V3 codebase** for both Chrome and Edge
(see [`chrome-extension-release.md`](chrome-extension-release.md) for
the Chrome flow). Edge is a fully supported alternative but **Chrome
remains the primary marketing browser** — the Edge package exists to
make the same extension available to Microsoft Edge users.

Edge's developer experience is intentionally almost identical to
Chrome's. Where it differs, this doc calls it out.

## 1. Test the extension in Edge

The unpacked workflow is the same as Chrome's:

1. Open `edge://extensions`.
2. Enable **Developer mode** (bottom-left toggle).
3. Click **Load unpacked** and select `apps/extension`.
4. Open the popup, sign in with the demo account, capture a page.

Edge-specific gotchas:

- Edge's `edge://extensions` page is the analogue of `chrome://extensions`.
- Edge supports every Chrome Manifest V3 API the extension uses
  (`chrome.storage`, `chrome.runtime`, `chrome.tabs`, `chrome.contextMenus`,
  `chrome.notifications`, `chrome.action`, `chrome.scripting`).
- Edge does **not** ship the Chrome Web Store's "Saved tabs" API;
  we don't depend on it.

## 2. Compatibility audit

The extension uses these Chrome APIs:

| API | Edge support |
|-----|--------------|
| `chrome.storage` (local/sync) | ✓ identical |
| `chrome.runtime` (sendMessage, getURL) | ✓ identical |
| `chrome.tabs` (query, update) | ✓ identical |
| `chrome.contextMenus` | ✓ identical |
| `chrome.notifications` | ✓ identical |
| `chrome.action` (popup) | ✓ identical |
| `chrome.scripting` (executeScript) | ✓ identical |

No code changes are needed to ship on Edge.

## 3. Bump the version

Use the same `apps/extension/manifest.json` `version` field. Microsoft
Edge Add-ons requires the version to be strictly greater than the
current live version, just like the Chrome Web Store.

## 4. Configure the production URLs

```bash
# Required: production REST base URL
export MNEMONICS_API_URL=https://api.mnemonics.app

# Optional: production web URL the popup links to
export MNEMONICS_WEB_URL=https://app.mnemonics.app
```

The web URL is a placeholder in the bundle (`__MNEMONICS_WEB_URL__`)
that the packager rewrites. If you don't set it, the field is left
empty in the bundle and the popup falls back to its dev default.

## 5. Package the Edge ZIP

```bash
pnpm extension:package:edge
```

The output is `dist/mnemonics-edge-extension.zip`. The Edge bundle is
byte-identical to the Chrome bundle (same `manifest.json`, same JS,
same icons). We keep them as separate artifacts so the Edge dashboard
shows a fresh upload even when the Chrome listing hasn't been
updated.

Verify before uploading:

```bash
# 1. Confirm the manifest in the zip is valid JSON.
unzip -p dist/mnemonics-edge-extension.zip manifest.json | python -m json.tool

# 2. Confirm no placeholders leak.
unzip -p dist/mnemonics-edge-extension.zip manifest.json | grep -c __MNEMONICS_
# expected: 0

# 3. Confirm the CSP points at your prod API.
unzip -p dist/mnemonics-edge-extension.zip manifest.json | grep connect-src
```

## 6. Microsoft Edge Add-ons submission

1. Go to the [Microsoft Partner Center][partner] → **Edge** →
   **Create a new extension**.
2. Pay the one-time $19 developer fee (if you haven't already).
3. Upload `dist/mnemonics-edge-extension.zip`.
4. Fill in the listing form. The Edge Add-ons fields are very
   similar to Chrome's:
   - **Name**: "Mnemonics — Quick Capture"
   - **Short description** (≤ 132 chars)
   - **Long description** (full feature list + privacy link)
   - **Category**: Productivity
   - **Icon**: 128×128 PNG
   - **Screenshots**: at least one 1280×800 PNG
5. **Privacy**:
   - Permission justifications mirror Chrome's. See
     [`chrome-extension-release.md`](chrome-extension-release.md#8-permissions-justification).
6. Click **Save** → **Submit for certification**.

[partner]: https://partner.microsoft.com/dashboard/microsoftedge/

## 7. Listing metadata

The Edge Add-ons listing should mirror the Chrome Web Store listing:

- **Name**: "Mnemonics — Quick Capture" (must match the
  `manifest.json` `name` field)
- **Description** language: English (or whichever locale you
  release first)
- **Privacy policy URL**: same URL as the Chrome Web Store listing
- **Support contact**: a real email; Edge reviews reject listings
  with a no-reply support address.

## 8. After approval: wire it up

Once Edge approves the extension, copy the Edge Add-ons URL
(`https://microsoftedge.microsoft.com/addons/detail/<extension-id>`)
and set it as the `VITE_EDGE_EXTENSION_URL` env-var in the web
deployment pipeline.

```bash
# In the web deployment env:
VITE_EDGE_EXTENSION_URL=https://microsoftedge.microsoft.com/addons/detail/<extension-id>
```

Verify on the live site:

- [ ] `/browser-extension` page shows "Add to Edge" with the configured URL
- [ ] Clicking the Edge CTA opens the Edge Add-ons page in a new tab
  with `target="_blank" rel="noopener noreferrer"`
- [ ] The header "Get Mnemonics" CTA still prefers Chrome
- [ ] On an Edge browser, the auto-detected CTA hints at Edge first
  (the detection lives in `apps/web/src/config/browser.ts`)

## 9. Keeping Chrome and Edge in sync

Because the codebase is shared, the typical release flow is:

```bash
# 1. Bump version in manifest.json, commit.
# 2. Tag the commit.
git tag v1.0.1
# 3. Package both bundles.
pnpm extension:package
# 4. Upload both zips:
#    - dist/mnemonics-chrome-extension.zip → Chrome Web Store
#    - dist/mnemonics-edge-extension.zip   → Edge Add-ons
# 5. Once both are approved, update the env-vars in the web
#    pipeline and re-deploy.
```

We **do not** ship store-specific forks. If a future need requires
diverging, that change must happen in a single, well-flagged spot
(not in scattered `if (isEdge)` branches).
