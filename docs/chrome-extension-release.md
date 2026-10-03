# Releasing the Mnemonics Chrome extension

This is the step-by-step flow to ship a release of the Mnemonics
extension to the **Chrome Web Store**. Mnemonics ships ONE Manifest V3
codebase that targets both Chrome and Edge; see
[`edge-extension-release.md`](edge-extension-release.md) for the Edge
flow.

## 1. Test the extension

```bash
# 1. Start the API and web dev servers
pnpm demo:prepare
pnpm demo:api
pnpm demo:web

# 2. Load the unpacked extension
#    - Open chrome://extensions
#    - Enable Developer mode
#    - Click "Load unpacked" and select apps/extension
#    - Open the popup, sign in with the demo account
#    - Capture a page, save an image, take a screenshot
#    - Confirm the new memory appears in /app
```

The extension tests cover the most common flows:

```bash
pnpm --filter @mnemonics/extension-tests test
```

## 2. Bump the version

Edit `apps/extension/manifest.json` and increment `version`:

```json
{
  "version": "1.0.1"
}
```

Semver-ish: `MAJOR.MINOR.PATCH`. The Chrome Web Store rejects
versions that are not strictly greater than the current live version.

## 3. Configure the production API

The packager bakes the production API URL into the bundle at
package-time. The default in the source tree is `http://localhost:4000`
— you **must** set `MNEMONICS_API_URL` to your real API host before
packaging, otherwise the Chrome Web Store will reject the CSP.

```bash
# Required: production REST base URL
export MNEMONICS_API_URL=https://api.mnemonics.app
```

## 4. Package the ZIP

```bash
# From the repo root:
pnpm extension:package:chrome
```

The output is `dist/mnemonics-chrome-extension.zip` plus an
unzipped directory for `Load unpacked` testing. The packager:

- Strips `tests/`, `*.test.js`, source maps, `README.md`
- Replaces the `__MNEMONICS_API_URL__` placeholder in `manifest.json`
- Emits a STORE-only zip (no compression; both stores accept this)

Verify the zip before uploading:

```bash
# 1. Confirm the manifest in the zip is valid JSON.
unzip -p dist/mnemonics-chrome-extension.zip manifest.json | python -m json.tool

# 2. Confirm no placeholder is left in any baked file.
unzip -p dist/mnemonics-chrome-extension.zip manifest.json | grep -c __MNEMONICS_API_URL__
# expected: 0

# 3. Confirm the CSP points at your prod API.
unzip -p dist/mnemonics-chrome-extension.zip manifest.json | grep connect-src
# expected: connect-src 'self' https://api.mnemonics.app ...
```

The packager has its own smoke test:

```bash
pnpm extension:package:test
```

## 5. Chrome Web Store Developer Dashboard

1. Go to the [Chrome Web Store Developer Dashboard][cws].
2. Pay the one-time $5 developer fee (if you haven't already).
3. Click **New Item** and upload `dist/mnemonics-chrome-extension.zip`.
4. Fill in the listing form. Listing assets you should have ready:
   - **Name**: "Mnemonics — Quick Capture"
   - **Summary** (≤ 132 chars): one-sentence value prop.
   - **Description** (≤ 16 000 chars): full feature list, screenshots,
     privacy summary, and a link to the privacy policy.
   - **Category**: Productivity
   - **Language**: English
   - **Icon**: 128×128 PNG (`apps/extension/icon128.png`)
   - **Screenshots**: 1× 1280×800 or 640×400 (at least one)
   - **Marquee promotional tile** (optional): 1400×560
5. **Privacy**:
   - Single purpose: "Capture web pages, images, screenshots and quick
     notes for the user's Mnemonics library."
   - Permission justifications: explain why each `permissions` entry
     from `manifest.json` is required. See §8.
6. **Distribution**: "Public" (or "Unlisted" for a private rollout).
7. Click **Save Draft** → **Submit for Review**.

[cws]: https://chrome.google.com/webstore/devconsole/

## 6. Listing assets

Drop screenshots and marquee assets under `docs/listing-assets/`:

```
docs/listing-assets/
├── icon-128.png
├── screenshot-1-1280x800.png
├── screenshot-2-1280x800.png
└── marquee-1400x560.png
```

Source the originals from a real install — Google rejects clearly
mocked-up screenshots.

## 7. Privacy policy

The privacy policy lives at `apps/web/public/privacy/` (or
[docs/privacy.md](../privacy.md) in this repo, depending on how the
public site is wired up). The Chrome Web Store listing must link to
the **public, hosted** privacy policy URL.

## 8. Permissions justification

| Permission | Why |
|------------|-----|
| `activeTab` | Read the title/URL of the current tab when the user clicks the popup. |
| `storage` | Persist the access token + the pending-upload queue. |
| `tabs` | Open the dashboard tab from the popup. |
| `contextMenus` | "Save to Mnemonics" on selected text and images. |
| `notifications` | Surface capture-success / capture-failure toasts. |
| `unlimitedStorage` | Allow large OCR/screenshot payloads to be queued offline. |

`host_permissions: ["<all_urls>"]` is required because the user
explicitly asks us to save a page from whatever site they're on.
Restricted hosts (e.g. Chrome Web Store itself) are still respected.

## 9. Review timeline

The Chrome Web Store review typically takes 1–3 days for new
submissions and < 24 hours for updates. If the review is rejected,
read the rejection email carefully — most rejections are due to:

- A placeholder URL leaking into the CSP (run `pnpm extension:package:test`)
- A "broad permission" warning that needs a justification in the
  Privacy tab
- A missing privacy policy URL

## 10. After approval: configure the public site

Once the extension is approved, copy the Chrome Web Store URL
(`https://chromewebstore.google.com/detail/<extension-id>`) and set
it as the `VITE_CHROME_EXTENSION_URL` env-var in the web deployment
pipeline. This wires the "Add to Chrome" CTAs on the public site to
the live Web Store listing.

```bash
# In the web deployment env (Vercel, Netlify, etc.):
VITE_CHROME_EXTENSION_URL=https://chromewebstore.google.com/detail/<extension-id>
```

Verify on the live site:

- [ ] Homepage hero shows the Chrome CTA → click → opens the Web Store in a new tab
- [ ] `/browser-extension` shows the same CTA + a working Edge companion
- [ ] No "Chrome Web Store release coming soon" modal is shown
