// `loadSession` on jsdom with an opaque origin (the way the CI test
// harness constructs it) used to throw `SecurityError: localStorage
// is not available for opaque origins`. That rejected the promise
// silently, every spec waiting for `state.user` never saw it, and 30
// dashboard tests failed with "selector not found" or
// "expected 'login' to be 'everything'".
//
// The fix wraps the read and the mirror write in `try` / `catch` so
// the function falls through to `chrome.storage.local` instead of
// rejecting. This regression test exercises the same call path on a
// fresh opaque-origin JSDOM and asserts `state.user` resolves from
// the chrome.storage fallback the way it would in production.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('opaque-origin localStorage handling', () => {
  it('loadSession falls back to chrome.storage.local without throwing', async () => {
    const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
      .replace(/<script src="api-client\.js"><\/script>/, '')
      .replace(/<script src="dashboard\.js"><\/script>/, '');

    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'chrome-extension://aaaaaaaaaaaaaaaa/mnemonics-dashboard.html',
      pretendToBeVisual: true
    });

    // Override the default JSDOM `localStorage` stub so a call to
    // `getItem` throws a SecurityError, mirroring the runtime
    // behaviour of jsdom on a Linux CI runner with a `chrome-extension`
    // origin. Without this, the JS shim returns `undefined` for
    // `localStorage` and the `typeof` check short-circuits the bug
    // before the `getItem` is ever called.
    class OpaqueSecurityError extends Error {
      constructor() { super('localStorage is not available for opaque origins'); }
    }
    Object.defineProperty(dom.window, 'localStorage', {
      configurable: true,
      get() {
        return {
          getItem() { throw new OpaqueSecurityError(); },
          setItem() { throw new OpaqueSecurityError(); },
          removeItem() {}
        };
      }
    });
    const session = {
      accessToken: 'tkn',
      refreshToken: 'rfr',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u1', email: 'u1@example.com' }
    };
    let stored: unknown = session;
    dom.window.chrome = {
      storage: {
        local: {
          get(_k: string, cb: (r: Record<string, unknown>) => void) {
            cb(stored ? { mnemonics_session: stored } : {});
          },
          set(o: Record<string, unknown>) { stored = o.mnemonics_session; }
        }
      },
      runtime: { onMessage: { addListener() {} } }
    } as never;

    dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8'));
    dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8'));

    // Let `loadSession` (async) settle, plus a render pass.
    await new Promise((r) => setTimeout(r, 50));

    // The dashboard must not have rendered the login screen; the
    // top nav, which the signed-in route exposes, must be visible.
    const topNav = dom.window.document.querySelector('.mnx-topnav') as HTMLElement | null;
    expect(topNav, 'top nav must be present when chrome.storage has a session').toBeTruthy();
    expect(topNav?.hidden, 'top nav must be visible — i.e. state.user resolved').toBe(false);
  });
});


