# Extension source manifests

The `manifest.json` and any inline URL placeholders in this directory ship with
**development defaults** baked in so that `chrome://extensions` → "Load unpacked"
loads a working extension without needing a packaging step.

| Placeholder / field                     | Dev default                  | Why                                                       |
|-----------------------------------------|------------------------------|-----------------------------------------------------------|
| `connect-src …` in `manifest.json`      | `http://localhost:4000`      | CSP must be valid JSON; tokens break `Load unpacked` work. |
| `MNEMONICS_WEB_URL` in `extension.js`   | `''` (empty string)          | Popup falls back to bundled offline dashboard in dev.     |

## Production overrides

The packager (`scripts/package-extension.mjs`) replaces these defaults when
you run `pnpm extension:package:chrome` or `pnpm extension:package:edge` with
the corresponding env vars set:

```bash
MNEMONICS_API_URL=https://api.mnemonics.app \
MNEMONICS_WEB_URL=https://app.mnemonics.app \
pnpm extension:package:chrome
```

The packager is **idempotent**: if a source value is already a concrete URL or
is empty, only the token-shaped placeholders are rewritten. If a real
production URL is accidentally committed to source, the packager will still
overwrite it from the env, so prod wins over dev.

## Why not keep `__MNEMONICS_*__` placeholders in source?

Chrome parses `manifest.json` at load time. A placeholder is not a valid CSP
source and Chrome logs:

> The source list for the Content Security Policy directive 'connect-src'
> contains an invalid source: '__MNEMONICS_API_URL__'. It will be ignored.

That makes the extension silently fall back to `connect-src 'self'`, which
breaks every API call in production. The dev defaults below avoid that footgun
for unpacked-load workflows.