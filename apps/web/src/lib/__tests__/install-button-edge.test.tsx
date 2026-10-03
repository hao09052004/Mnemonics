/**
 * Tests for the Edge variant of the InstallExtensionButton.
 *
 * The Chrome variant is covered by `install-button.test.tsx`. Here
 * we exercise:
 *   - Edge button label + testid
 *   - Opening the Edge Add-ons URL when configured
 *   - Falling back to the modal when the Edge URL is missing
 *   - Browser-detection fallback: when no `browser` prop is given
 *     and the UA says Edge, the button should render the Edge variant
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { InstallExtensionButton } from '../../components/extension/InstallExtensionButton';

const ORIGINAL_OPEN = window.open;
const ORIGINAL_UA = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true
  });
}

beforeEach(() => {
  window.open = vi.fn();
});

afterEach(() => {
  window.open = ORIGINAL_OPEN;
  setUserAgent(ORIGINAL_UA);
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('InstallExtensionButton — Edge variant', () => {
  it('renders "Add to Edge" when browser="edge"', () => {
    render(<InstallExtensionButton browser="edge" />);
    const btn = screen.getByTestId('install-edge-btn');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Add to Edge/i);
    expect(btn.getAttribute('data-browser')).toBe('edge');
  });

  it('auto-detects Edge and renders the Edge variant by default', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91'
    );
    // Re-import to get a fresh module that sees the new UA on first
    // effect-run.
    const mod = await import('../../components/extension/InstallExtensionButton');
    render(<mod.InstallExtensionButton />);
    // Give the useEffect a microtask to settle.
    await new Promise((r) => setTimeout(r, 0));
    const btn = screen.getByTestId('install-edge-btn');
    expect(btn).toBeInTheDocument();
  });

  it('falls back to a modal when the Edge URL is missing', () => {
    render(<InstallExtensionButton browser="edge" />);
    const btn = screen.getByTestId('install-edge-btn');
    expect(btn.getAttribute('data-store-configured')).toBe('false');
    fireEvent.click(btn);
    expect(window.open).not.toHaveBeenCalled();
    const modal = screen.getByTestId('install-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.getAttribute('data-store')).toBe('edge');
  });

  it('shows the edge://extensions instruction in the dev fallback', () => {
    render(<InstallExtensionButton browser="edge" />);
    fireEvent.click(screen.getByTestId('install-edge-btn'));
    // The <summary> element specifically carries this text.
    const summary = screen.getByText(/Load the development build/i, {
      selector: 'summary'
    });
    fireEvent.click(summary);
    expect(screen.getByText(/edge:\/\/extensions/i)).toBeInTheDocument();
  });
});
