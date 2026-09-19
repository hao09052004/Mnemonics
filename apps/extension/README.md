# Mnemonics Extension

This is the current working Chrome Manifest V3 extension.

Implemented locally:

- Popup capture for page metadata, notes, links and selected text.
- Context-menu capture for links, selections and images.
- Screenshot capture and crop flow.
- Local dashboard with demo data, local authentication and local storage.

Current limitation: this app still stores data in `chrome.storage.local`. It does not yet call the Capture API or share authentication with the SaaS dashboard.

Load `manifest.json` from this directory using Chrome's **Load unpacked** flow.