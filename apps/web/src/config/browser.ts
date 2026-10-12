/**
 * Lightweight browser detection.
 *
 * We don't load a 3rd-party "detect.js" — the user agent already tells
 * us what we need. Used by the install button to copy-pick the right
 * label ("Add to Chrome" vs "Add to Edge") and to render the correct
 * "coming soon" message for browsers we don't ship builds for.
 *
 * Truth table:
 *   Chrome   →  "Add to Chrome"  (Web Store works)
 *   Brave    →  "Add to Brave"   (uses the same Chrome Web Store listing
 *                                 because Brave accepts Chromium .crx)
 *   Edge     →  "Add to Edge"    (Microsoft Edge Add-ons works; the
 *                                 button will fall back to the Chrome
 *                                 Web Store listing only if no Edge
 *                                 listing has been configured yet)
 *   Opera    →  "Add to Chrome"  (uses Chrome Web Store)
 *   Firefox  →  "Firefox version coming soon"
 *   Safari   →  "Safari version coming soon"
 *   unknown  →  "Add to Chrome"  (manual user choice still allowed)
 *
 * `storeUrlBrowser` is the *type* of store link the install button
 * should open for this detected browser — not a guarantee that the
 * corresponding env-var is set. The button consults
 * `productConfig.edgeExtensionUrl` / `chromeExtensionUrl` separately
 * before opening a URL.
 */
export type BrowserKind =
  | 'chrome'
  | 'brave'
  | 'edge'
  | 'firefox'
  | 'safari'
  | 'other';

/** Which configured store URL this browser should consult. */
export type StoreUrlKind = 'chrome' | 'edge';

const UNKNOWN: BrowserKind = 'other';

function fromUserAgent(ua: string): BrowserKind {
  const lower = ua.toLowerCase();
  // Edge and Opera both spoof Chrome — check them first.
  if (lower.includes('edg/') || lower.includes('edga/') || lower.includes('edgios/')) {
    return 'edge';
  }
  if (lower.includes('opera') || lower.includes('opr/')) {
    return 'chrome';
  }
  // Brave exposes itself via `Brave/` in some builds but not all, so we
  // can't fully trust UA alone — fall back to a runtime feature check.
  if (lower.includes('firefox/')) {
    return 'firefox';
  }
  if (lower.includes('safari/') && !lower.includes('chrome/')) {
    return 'safari';
  }
  if (lower.includes('chrome/') || lower.includes('crios/')) {
    return 'chrome';
  }
  return UNKNOWN;
}

function hasBraveSignature(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> | boolean };
  };
  // Promise API surfaces on the Brave navigator object. We just need to
  // know whether the property is there — the install button doesn't
  // await the actual `isBrave()` result.
  return Boolean(nav.brave && typeof nav.brave.isBrave === 'function');
}

export function detectBrowser(): BrowserKind {
  if (typeof navigator === 'undefined') return UNKNOWN;
  const ua = navigator.userAgent || '';
  const detected = fromUserAgent(ua);
  if (detected === 'chrome' && hasBraveSignature()) return 'brave';
  return detected;
}

export interface InstallLabel {
  primary: string;
  secondary: string;
  /** Which configured store URL the install button should open. */
  storeUrlBrowser: StoreUrlKind;
  /** When true, the corresponding store URL is configured and ready. */
  webStoreReady: boolean;
}

export function installLabelFor(browser: BrowserKind): InstallLabel {
  switch (browser) {
    case 'brave':
      return {
        primary: 'Add to Brave',
        secondary: 'Available through the Chrome Web Store',
        storeUrlBrowser: 'chrome',
        webStoreReady: true
      };
    case 'edge':
      return {
        primary: 'Add to Edge',
        secondary: 'Microsoft Edge Add-ons (or Chrome Web Store)',
        storeUrlBrowser: 'edge',
        webStoreReady: true
      };
    case 'firefox':
      return {
        primary: 'Add to Firefox',
        secondary: 'Firefox version coming soon',
        storeUrlBrowser: 'chrome',
        webStoreReady: false
      };
    case 'safari':
      return {
        primary: 'Add to Safari',
        secondary: 'Safari version coming soon',
        storeUrlBrowser: 'chrome',
        webStoreReady: false
      };
    case 'chrome':
    case 'other':
    default:
      return {
        primary: 'Add to Chrome',
        secondary: 'Works with Chrome, Brave and Chromium-based browsers',
        storeUrlBrowser: 'chrome',
        webStoreReady: true
      };
  }
}
