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
import { useLocale } from '../../lib/locale';

type ButtonBrowser = 'chrome' | 'edge';

interface InstallExtensionButtonProps {
  browser?: ButtonBrowser;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  onClickOverride?: () => void;
  className?: string;
}

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
  const { t } = useLocale();

  useEffect(() => {
    setDetected(detectBrowser());
  }, []);

  const browser: ButtonBrowser =
    requestedBrowser ??
    (detected === 'edge' ? 'edge' : 'chrome');

  const label = installLabelFor(detected);
  const buttonText =
    browser === 'edge'
      ? t('hero_add_edge', 'Add to Edge')
      : t('hero_add_chrome', 'Add to Chrome');
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
      <circle cx="12" cy="12" r="11" fill="currentColor" fillOpacity="0.16" />
      <path
        d="M5.5 13.5C5.5 9.36 8.86 6 13 6c3.04 0 5.5 1.83 6.5 4.5-1.2-1.4-3.1-2.3-5.2-2.3-3.5 0-6.4 2.4-6.4 5.3 0 1.6.8 2.9 2.1 3.6-2.7-.6-4.5-2.6-4.5-3.6Z"
        fill="currentColor"
      />
      <path
        d="M19 12.4c.4 2.4-1.1 4.7-3.6 5.4-2.6.7-5.3-.6-6.1-3-.3-.9-.2-1.8.1-2.6.6-1.6 2.2-2.7 4-2.7 2.6 0 4.7 1.7 5.6 2.9Z"
        fill="currentColor"
        fillOpacity="0.8"
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
  const { t, locale } = useLocale();
  const isUnsupported = detectedBrowser === 'firefox' || detectedBrowser === 'safari';
  const title = isUnsupported
    ? t('modal_ext_title_other', 'Your browser is on the way.')
    : requestedBrowser === 'edge'
      ? t('modal_ext_title_edge', 'Microsoft Edge Add-ons release coming soon.')
      : t('modal_ext_title_chrome', 'Chrome Web Store release coming soon.');

  const description = isUnsupported
    ? t('modal_ext_desc_other', 'The Mnemonics extension is currently shipping on Chromium-based browsers. Firefox and Safari builds are in progress — sign in to the web app in the meantime to keep saving memories.')
    : requestedBrowser === 'edge'
      ? t('modal_ext_desc_edge', 'We are finalising the Microsoft Edge Add-ons review. In the meantime you can load the development build locally.')
      : t('modal_ext_desc_chrome', 'We are finalising the Chrome Web Store review. In the meantime you can load the development build locally.');

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
            {t('modal_ext_dev_summary', 'Load the development build')}
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
            <li>{t('modal_ext_step1', 'Download or clone the Mnemonics repo.')}</li>
            <li>
              {t('modal_ext_step2', 'Open in your browser:')} <code>{devUnpackUrl}</code>
            </li>
            <li>
              {locale === 'vi' ? (
                <>Bật <b>Chế độ nhà phát triển (Developer mode)</b> ở góc trên bên phải.</>
              ) : (
                <>Enable <b>Developer mode</b> in the top right.</>
              )}
            </li>
            <li>
              {locale === 'vi' ? (
                <>Nhấn <b>Tải tiện ích đã giải nén (Load unpacked)</b> và chọn <code>apps/extension</code>.</>
              ) : (
                <>Click <b>Load unpacked</b> and select <code>apps/extension</code>.</>
              )}
            </li>
          </ol>
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn--ghost btn--sm"
          >
            {t('btn_close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
