import { useEffect, useState } from 'react';
import {
  extensionStoreUrl,
  hasExtensionUrl,
  productConfig
} from '../../config/product';
import {
  detectBrowser,
  installLabelFor,
  type BrowserKind,
  type StoreUrlKind
} from '../../config/browser';

type ButtonBrowser = 'chrome' | 'edge';

interface InstallExtensionButtonProps {
  /**
   * Which store the button targets. When omitted, the button
   * auto-detects from the user agent.
   *
   *   - "chrome" → "Add to Chrome", opens VITE_CHROME_EXTENSION_URL
   *   - "edge"   → "Add to Edge",   opens VITE_EDGE_EXTENSION_URL
   *
   * The Chrome CTA is always rendered first and with a stronger visual
   * weight — that order is enforced by callers, not this component.
   */
  browser?: ButtonBrowser;
  /** Visual treatment. "primary" is the bold violet filled button. */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  /**
   * When true, the button is full-width inside its container.
   * Used inside the AuthLayout's narrow email panel.
   */
  fullWidth?: boolean;
  /**
   * Optional click override. When provided, the default
   * navigate-to-store / open-modal behaviour is bypassed. Used by
   * the homepage hero which prefers to route to /browser-extension
   * instead of opening the Web Store directly.
   */
  onClickOverride?: () => void;
  className?: string;
}

const PRIMARY_LABELS: Record<ButtonBrowser, string> = {
  chrome: 'Add to Chrome',
  edge: 'Add to Edge'
};

const COMING_SOON_TITLE: Record<StoreUrlKind, { chrome: string; edge: string }> = {
  chrome: {
    chrome: 'Chrome Web Store release coming soon.',
    edge: 'Microsoft Edge Add-ons release coming soon.'
  },
  edge: {
    chrome: 'Chrome Web Store release coming soon.',
    edge: 'Microsoft Edge Add-ons release coming soon.'
  }
};

/**
 * "Add to Chrome" / "Add to Edge" CTA.
 *
 * Behaviour:
 *   1. If a store URL is configured for the requested browser AND the
 *      detected browser supports it, open the URL in a new tab with
 *      `target="_blank" rel="noopener noreferrer"`.
 *   2. If the URL isn't configured (or the browser is Firefox/Safari),
 *      open an InstallModal so the user never sees a broken link.
 *   3. If `onClickOverride` is provided, defer to the caller.
 *
 * Edge users get the Edge Add-ons URL; Chrome/Brave/Opera users get
 * the Chrome Web Store URL. The button itself doesn't care which
 * store the detected browser *would* prefer — that decision belongs
 * to the caller. The hero always renders Chrome first; an "Also on
 * Edge" companion is rendered alongside.
 */
export function InstallExtensionButton({
  browser: requestedBrowser,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  onClickOverride,
  className
}: InstallExtensionButtonProps) {
  const [detected, setDetected] = useState<BrowserKind>('other');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setDetected(detectBrowser());
  }, []);

  // Default browser is the detected one; if detection says edge and no
  // explicit prop, we still render the Edge button. The caller can
  // override.
  const browser: ButtonBrowser =
    requestedBrowser ??
    (detected === 'edge' ? 'edge' : 'chrome');

  const label = installLabelFor(detected);
  // The "Add to {Browser}" label is *separate* from the detected
  // browser's `installLabelFor` — that one is for the auto-detected
  // label when the caller doesn't pass a `browser` prop. Here we
  // honour the caller's intent.
  const buttonText = PRIMARY_LABELS[browser];
  const storeUrl = extensionStoreUrl(browser);
  const storeConfigured = hasExtensionUrl(browser);
  // The install button only opens the store for browsers that have
  // a sane target. Firefox/Safari still get a "coming soon" modal.
  const browserSupported = label.webStoreReady;
  const sizeClass = size === 'lg' ? 'btn--lg' : '';
  const variantClass =
    variant === 'primary'
      ? 'btn--brand'
      : variant === 'secondary'
        ? 'btn--outline'
        : 'btn--ghost';
  const classes = ['btn', variantClass, sizeClass, className]
    .filter(Boolean)
    .join(' ');

  const handleClick = () => {
    if (onClickOverride) {
      onClickOverride();
      return;
    }
    if (storeConfigured && browserSupported) {
      window.open(storeUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setModalOpen(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid={
          browser === 'edge' ? 'install-edge-btn' : 'install-extension-btn'
        }
        data-browser={browser}
        data-store-configured={storeConfigured ? 'true' : 'false'}
        data-web-store-ready={
          storeConfigured && browserSupported ? 'true' : 'false'
        }
        onClick={handleClick}
        className={classes}
        aria-label={buttonText}
        style={fullWidth ? { width: '100%', justifyContent: 'center' } : undefined}
      >
        {browser === 'edge' ? <EdgeGlyph /> : <ChromeGlyph />}
        <span>{buttonText}</span>
      </button>
      {modalOpen && (
        <InstallModal
          requestedBrowser={browser}
          detectedBrowser={detected}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function ChromeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.18)" />
      <path
        d="M12 4.5a7.5 7.5 0 0 0-6.36 3.51L12 12l5.32-3.27A4.5 4.5 0 0 0 12 4.5Z"
        fill="#fff"
      />
      <circle cx="12" cy="12" r="3.5" fill="#5b3fe4" />
      <path
        d="M5.64 8.01A7.5 7.5 0 0 0 9 19.5l3-7.5-6.36-4Z"
        fill="#fff"
        fillOpacity="0.85"
      />
      <path
        d="M18.36 8.01 12 12l3 7.5a7.5 7.5 0 0 0 3.36-11.49Z"
        fill="#fff"
        fillOpacity="0.65"
      />
    </svg>
  );
}

function EdgeGlyph() {
  // Simplified Edge-style swirl + ring. Deliberately distinct from
  // Microsoft's official mark to keep the brand unique while still
  // reading as "browser-shaped".
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.18)" />
      <path
        d="M5.5 13.5C5.5 9.36 8.86 6 13 6c3.04 0 5.5 1.83 6.5 4.5-1.2-1.4-3.1-2.3-5.2-2.3-3.5 0-6.4 2.4-6.4 5.3 0 1.6.8 2.9 2.1 3.6-2.7-.6-4.5-2.6-4.5-3.6Z"
        fill="#fff"
      />
      <path
        d="M19 12.4c.4 2.4-1.1 4.7-3.6 5.4-2.6.7-5.3-.6-6.1-3-.3-.9-.2-1.8.1-2.6.6-1.6 2.2-2.7 4-2.7 2.6 0 4.7 1.7 5.6 2.9Z"
        fill="#fff"
        fillOpacity="0.85"
      />
    </svg>
  );
}

interface InstallModalProps {
  requestedBrowser: ButtonBrowser;
  detectedBrowser: BrowserKind;
  onClose: () => void;
}

function InstallModal({
  requestedBrowser,
  detectedBrowser,
  onClose
}: InstallModalProps) {
  const isUnsupported = detectedBrowser === 'firefox' || detectedBrowser === 'safari';
  const title = isUnsupported
    ? 'Your browser is on the way.'
    : COMING_SOON_TITLE[requestedBrowser][requestedBrowser];

  const description = isUnsupported
    ? 'The Mnemonics extension is currently shipping on Chromium-based browsers. Firefox and Safari builds are in progress — sign in to the web app in the meantime to keep saving memories.'
    : requestedBrowser === 'edge'
      ? 'We are finalising the Microsoft Edge Add-ons review. In the meantime you can load the development build locally.'
      : 'We are finalising the Chrome Web Store review. In the meantime you can load the development build locally.';

  const devUnpackUrl = requestedBrowser === 'edge' ? 'edge://extensions' : 'chrome://extensions';

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="install-modal"
      data-store={requestedBrowser}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17,17,17,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 28px',
          maxWidth: 480,
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)'
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--brand)'
          }}
        >
          Mnemonics Extension
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            margin: '8px 0 12px',
            lineHeight: 1.15
          }}
        >
          {title}
        </h2>
        <p
          style={{
            color: 'var(--muted)',
            lineHeight: 1.55,
            marginBottom: 18
          }}
        >
          {description}
        </p>

        <details
          data-testid="install-modal-dev"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            marginBottom: 18
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink)' }}>
            Load the development build
          </summary>
          <ol
            style={{
              margin: '12px 0 0',
              paddingLeft: 20,
              color: 'var(--muted)',
              fontSize: 14,
              lineHeight: 1.6
            }}
          >
            <li>Download or clone the Mnemonics repo.</li>
            <li>
              Open <code>{devUnpackUrl}</code> in your browser.
            </li>
            <li>
              Enable <b>Developer mode</b> in the top right.
            </li>
            <li>
              Click <b>Load unpacked</b> and select <code>apps/extension</code>.
            </li>
          </ol>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn--ghost btn--sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
