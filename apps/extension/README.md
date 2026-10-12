# Mnemonics Chrome Extension

Manifest V3 quick-capture client for the Mnemonics second brain.

## What is demo-ready

The extension supports:

- Capture page title, selected text/notes and links.
- Screenshot capture + crop flow.
- API uploads through `POST /api/v1/captures`.
- Stable `clientRequestId` values for idempotent retries.
- Expired-token refresh + one retry on `401`.
- Durable pending-upload retry from the background service worker.
- Per-user local cache plus reconciliation with the API-backed dashboard.
- Related-memory requests from the dashboard.

## Run locally

Start the demo API first:

```bash
pnpm demo:prepare
pnpm demo:api
```

Then load this directory as an unpacked extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/extension`.
5. Open **DASHBOARD** in the extension and sign in with the demo account:
   `demo@mnemonics.local / DemoPass123!`
6. Return to the extension popup, capture a page, and click **LƯU KÝ ỨC**.

The capture is written locally first, then uploaded to the API. When the server-side pipeline finishes, the dashboard reconciles the item by its `clientRequestId`.

## Demo order

For the cleanest product demo:

1. Start with `pnpm demo:prepare`.
2. Run `pnpm demo:api` and `pnpm demo:web`.
3. Show the seeded memories in the web dashboard.
4. Use **+ Lưu nhanh** to create a new memory.
5. Show its processing status changing to **Ready**.
6. Search for a related concept.
7. Open **Ý liên quan** on a ready card.
8. Show the Chrome extension and repeat the same capture flow from a real web page.

The demo environment is intentionally local-only and must not be used as a production authentication mode.
