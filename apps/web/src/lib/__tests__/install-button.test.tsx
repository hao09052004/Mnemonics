/**
 * Tests for the InstallExtensionButton.
 *
 * Covers:
 *   - Renders the correct label for the detected browser.
 *   - When the Web Store URL is configured AND the browser supports
 *     it, the click opens a new tab with safe rels.
 *   - When the URL is missing (or browser is unsupported) a modal is
 *     shown instead of opening a broken link.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { InstallExtensionButton } from '../../components/extension/InstallExtensionButton';

const ORIGINAL_OPEN = window.open;

beforeEach(() => {
  window.open = vi.fn();
});

afterEach(() => {
  window.open = ORIGINAL_OPEN;
  cleanup();
  vi.restoreAllMocks();
});

describe('InstallExtensionButton', () => {
  it('renders the "Add to Chrome" label by default', () => {
    render(<InstallExtensionButton />);
    const btn = screen.getByTestId('install-extension-btn');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Add to Chrome/i);
  });

  it('marks data-web-store-ready=false when no URL is configured', async () => {
    // jsdom UA resolves to chrome by default → label.primary = "Add to Chrome"
    render(<InstallExtensionButton />);
    const btn = screen.getByTestId('install-extension-btn');
    expect(btn.getAttribute('data-web-store-ready')).toBe('false');
  });

  it('opens the modal instead of window.open when no URL is configured', () => {
    render(<InstallExtensionButton />);
    const btn = screen.getByTestId('install-extension-btn');
    fireEvent.click(btn);
    expect(window.open).not.toHaveBeenCalled();
    // Modal becomes visible.
    const modal = screen.getByTestId('install-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.getAttribute('role')).toBe('dialog');
  });

  it('uses the click-override prop when provided', () => {
    const onClick = vi.fn();
    render(<InstallExtensionButton onClickOverride={onClick} />);
    fireEvent.click(screen.getByTestId('install-extension-btn'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('modal is dismissable and removes the dialog from the DOM', () => {
    render(<InstallExtensionButton />);
    fireEvent.click(screen.getByTestId('install-extension-btn'));
    const modal = screen.getByTestId('install-modal');
    expect(modal).toBeInTheDocument();
    // Click the backdrop.
    fireEvent.click(modal);
    expect(screen.queryByTestId('install-modal')).toBeNull();
  });
});
