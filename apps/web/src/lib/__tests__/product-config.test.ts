/**
 * Smoke tests for productConfig.
 *
 * We can't easily mutate `import.meta.env` at runtime (Vite freezes
 * it at module-evaluation time), so these tests cover the helpers
 * and exercise the env-read path by direct import.
 */
import { describe, expect, it } from 'vitest';
import { hasChromeExtensionUrl, productConfig } from '../../config/product';

describe('productConfig', () => {
  it('apiBaseUrl is a non-empty string', () => {
    expect(typeof productConfig.apiBaseUrl).toBe('string');
    expect(productConfig.apiBaseUrl.length).toBeGreaterThan(0);
  });

  it('apiBaseUrl never ends with a trailing slash', () => {
    expect(productConfig.apiBaseUrl.endsWith('/')).toBe(false);
  });

  it('chromeExtensionUrl is a string (may be empty when not configured)', () => {
    expect(typeof productConfig.chromeExtensionUrl).toBe('string');
  });

  it('webUrl is a non-empty string', () => {
    expect(typeof productConfig.webUrl).toBe('string');
    expect(productConfig.webUrl.length).toBeGreaterThan(0);
  });

  it('hasChromeExtensionUrl matches whether the env-provided URL is non-empty', () => {
    const expected = productConfig.chromeExtensionUrl.length > 0;
    expect(hasChromeExtensionUrl()).toBe(expected);
  });
});
