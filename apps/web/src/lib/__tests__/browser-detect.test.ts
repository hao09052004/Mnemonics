/**
 * Smoke tests for browser detection.
 *
 * We stub `navigator.userAgent` per case to validate the truth table
 * for Chrome / Brave / Edge / Firefox / Safari.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { detectBrowser, installLabelFor } from '../../config/browser';

const ORIGINAL_UA = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

afterEach(() => {
  setUserAgent(ORIGINAL_UA);
});

describe('detectBrowser', () => {
  it('detects Chrome', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    expect(detectBrowser()).toBe('chrome');
  });

  it('detects Edge (which spoofs Chrome)', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91');
    expect(detectBrowser()).toBe('edge');
  });

  it('detects Firefox', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
    expect(detectBrowser()).toBe('firefox');
  });

  it('detects Safari (no Chrome token)', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15');
    expect(detectBrowser()).toBe('safari');
  });

  it('falls back to "other" for an unknown UA', () => {
    setUserAgent('totally-not-a-real-browser/0.0');
    expect(detectBrowser()).toBe('other');
  });
});

describe('installLabelFor', () => {
  it('labels Chrome correctly', () => {
    const label = installLabelFor('chrome');
    expect(label.primary).toBe('Add to Chrome');
    expect(label.webStoreReady).toBe(true);
  });

  it('labels Edge correctly with Web Store fallback note', () => {
    const label = installLabelFor('edge');
    expect(label.primary).toBe('Add to Edge');
    expect(label.webStoreReady).toBe(true);
    expect(label.secondary.toLowerCase()).toContain('chrome web store');
  });

  it('labels Firefox as coming soon', () => {
    const label = installLabelFor('firefox');
    expect(label.webStoreReady).toBe(false);
    expect(label.secondary.toLowerCase()).toContain('coming soon');
  });

  it('labels Safari as coming soon', () => {
    const label = installLabelFor('safari');
    expect(label.webStoreReady).toBe(false);
    expect(label.secondary.toLowerCase()).toContain('coming soon');
  });
});
