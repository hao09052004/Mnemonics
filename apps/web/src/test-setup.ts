/**
 * Global Vitest setup.
 *
 * - Registers `@testing-library/jest-dom` matchers (toBeInTheDocument,
 *   toHaveAttribute, …) so our component tests can use them.
 * - Polyfills the few DOM bits `jsdom` doesn't ship by default that
 *   the dashboard or extension components occasionally touch
 *   (matchMedia, ResizeObserver).
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
  }
  if (!(window as any).ResizeObserver) {
    (window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
