/**
 * Public product configuration.
 *
 * Single source of truth for the URLs the marketing site needs to know
 * about. None of these are hard-coded into React components — that
 * way, swapping the API host or Chrome Web Store link is an env-var
 * change, not a code change.
 *
 * Env contract (Vite injects `import.meta.env.VITE_*` at build time):
 *   VITE_API_URL                — REST base URL the dashboard/extension hit
 *   VITE_CHROME_EXTENSION_URL   — Chrome Web Store listing for the
 *                                 "Add to Chrome" CTA. Empty string in
 *                                 dev/preview = the button renders the
 *                                 "coming soon" modal instead of a link.
 *   VITE_WEB_URL                — Public web URL the extension uses to
 *                                 link back to the dashboard. Falls back
 *                                 to `window.location.origin` at runtime.
 */

export interface ProductConfig {
  apiBaseUrl: string;
  chromeExtensionUrl: string;
  webUrl: string;
}

const fallbackApiBaseUrl = (() => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  // Vite's dev server runs on :3000 and proxies /api → :4000. Use the
  // same-origin URL so the proxy handles everything. In any other
  // environment (staging, prod, preview) we honour the env var.
  const { hostname, port } = window.location;
  const isViteDev =
    (hostname === 'localhost' || hostname === '127.0.0.1') && port === '3000';
  if (isViteDev) return window.location.origin;
  return '';
})();

export const productConfig: ProductConfig = {
  apiBaseUrl: (
    import.meta.env.VITE_API_URL || fallbackApiBaseUrl
  ).replace(/\/$/, ''),
  chromeExtensionUrl: import.meta.env.VITE_CHROME_EXTENSION_URL || '',
  webUrl: (
    import.meta.env.VITE_WEB_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  ).replace(/\/$/, '')
};

export function hasChromeExtensionUrl(): boolean {
  return productConfig.chromeExtensionUrl.length > 0;
}
