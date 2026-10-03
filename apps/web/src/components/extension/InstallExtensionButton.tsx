import { useEffect, useState } from 'react';
import { hasChromeExtensionUrl, productConfig } from '../../config/product';
import { detectBrowser, installLabelFor, type BrowserKind } from '../../config/browser';

interface InstallExtensionButtonProps {
  /**
   * When true, render the "lg" size variant (hero). When false, render
   * the standard pill used in the section CTAs and final CTA block.
   */
  size?: 'md' | 'lg';
  /**
   * Optional click override. When provided, the default
   * navigate-to-Web-Store / open-modal behaviour is bypassed. Used by
   * the homepage hero which may want to navigate to /browser-extension
   * instead of opening the Web Store directly.
   */
  onClickOverride?: () => void;
  className?: string;
}

/**
 * "Add to Chrome" CTA.
 *
 * Behaviour:
 *   1. If a Web Store URL is configured AND the detected browser
 *      supports it, open the URL in a new tab with safe rels.
 *   2. If the URL isn't configured (or the browser is Firefox/Safari),
 *      open the InstallModal so the user never sees a broken link.
 *   3. If `onClickOverride` is provided, defer to the caller — this
 *      keeps the hero's "Add to Chrome" pointing to the dedicated
 *      landing page when the dedicated page is more appropriate.
 */
export function InstallExtensionButton({
  size = 'md',
  onClickOverride,
  className
}: InstallExtensionButtonProps) {
  const [browser, setBrowser] = useState<BrowserKind>('other');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  const label = installLabelFor(browser);
  const webStoreReady = hasChromeExtensionUrl() && label.webStoreReady;
  const sizeClass = size === 'lg' ? 'btn--lg' : '';
  const classes = ['btn', 'btn--brand', sizeClass, className].filter(Boolean).join(' ');

  const handleClick = () => {
    if (onClickOverride) {
      onClickOverride();
      return;
    }
    if (webStoreReady) {
      window.open(productConfig.chromeExtensionUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setModalOpen(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="install-extension-btn"
        data-browser={browser}
        data-web-store-ready={webStoreReady ? 'true' : 'false'}
        onClick={handleClick}
        className={classes}
        aria-label={label.primary}
      >
        <ChromeGlyph />
        <span>{label.primary}</span>
      </button>
      {modalOpen && <InstallModal browser={browser} onClose={() => setModalOpen(false)} />}
    </>
  );
}

function ChromeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff" fillOpacity="0.15" />
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

interface InstallModalProps {
  browser: BrowserKind;
  onClose: () => void;
}

function InstallModal({ browser, onClose }: InstallModalProps) {
  const isUnsupported = browser === 'firefox' || browser === 'safari';
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="install-modal"
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
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brand)' }}>
          Mnemonics Extension
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, margin: '8px 0 12px', lineHeight: 1.15 }}>
          {isUnsupported
            ? 'Your browser is on the way.'
            : 'Chrome Web Store release coming soon.'}
        </h2>
        <p style={{ color: 'var(--muted)', lineHeight: 1.55, marginBottom: 18 }}>
          {isUnsupported
            ? 'The Mnemonics extension is currently shipping on Chromium-based browsers. Firefox and Safari builds are in progress — sign in to the web app in the meantime to keep saving memories.'
            : 'We are finalising the Chrome Web Store review. In the meantime you can load the development build locally.'}
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
          <ol style={{ margin: '12px 0 0', paddingLeft: 20, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
            <li>Download or clone the Mnemonics repo.</li>
            <li>Open <code>chrome://extensions</code> in your browser.</li>
            <li>Enable <b>Developer mode</b> in the top right.</li>
            <li>Click <b>Load unpacked</b> and select <code>apps/extension</code>.</li>
          </ol>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn btn--ghost btn--sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
