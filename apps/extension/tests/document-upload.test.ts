// @vitest-environment jsdom
/**
 * Extension document upload wiring — minimal smoke test.
 *
 * Boots the real `api-client.js` and `dashboard.js` against a stub
 * `chrome.*` namespace and a stub `fetch`, then triggers the document
 * capture path:
 *
 *   1. Clicking the dashboard's "Upload Document" chip creates a
 *      hidden `<input type="file">` whose `accept` is scoped to the
 *      three supported MIME families.
 *   2. A `change` event with a fake PDF triggers a POST to
 *      `/api/v1/captures/document` carrying the multipart body.
 *   3. The dashboard never writes the file bytes to
 *      `chrome.storage.local`.
 *
 * This mirrors the working pattern in tab-refetch-user.test.ts:
 * load the full HTML, stub chrome + fetch, eval the scripts in order.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

const HTML = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
  .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');

const SESSION = {
  accessToken: 'e2e-access-token',
  refreshToken: 'e2e-refresh-token',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  tokenType: 'bearer'
};

const USER_OBJ = { id: '00000000-0000-4000-8000-0000000000ee', email: 'ext@mnemonics.test' };

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
  form?: FormData;
  headers?: Record<string, string>;
}

interface Harness {
  dom: JSDOM;
  calls: FetchCall[];
  storageWrites: Array<{ key: string; value: unknown }>;
  document: Document;
}

function boot(): Harness {
  const calls: FetchCall[] = [];
  const storageWrites: Array<{ key: string; value: unknown }> = [];

  const dom = new JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'chrome-extension://e2e-extension/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });
  // Capture the realm's FormData so the `instanceof` check below is
  // evaluated in the same realm the test will create FormData objects
  // in (and that api-client.js hands back to fetch).
  const jsdomFormData = dom.window.FormData;

  dom.window.fetch = (async (
    url: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
  ) => {
    const method = (init.method || 'GET').toUpperCase();
    let bodyStr: string | null = null;
    let form: FormData | undefined;
    if (init.body instanceof jsdomFormData) {
      form = init.body as unknown as FormData;
      bodyStr = '[multipart/form-data]';
    } else if (typeof init.body === 'string') {
      bodyStr = init.body;
    }
    calls.push({ url, method, body: bodyStr, form, headers: init.headers });

    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === '/api/v1/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { user: USER_OBJ } }),
        text: async () => JSON.stringify({ data: { user: USER_OBJ } }),
        headers: { get: () => null }
      };
    }
    if (path === '/api/v1/items' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items: [], total: 0 } }),
        text: async () => JSON.stringify({ data: { items: [], total: 0 } }),
        headers: { get: () => null }
      };
    }
    if (path === '/api/v1/spaces') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { spaces: [] } }),
        text: async () => JSON.stringify({ data: { spaces: [] } }),
        headers: { get: () => null }
      };
    }
    if (path === '/api/v1/captures/document' && method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { id: 'doc-1', status: 'pending' } }),
        text: async () => JSON.stringify({ data: { id: 'doc-1', status: 'pending' } }),
        headers: { get: () => null }
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: () => null }
    };
  }) as unknown as typeof fetch;

  dom.window.chrome = {
    storage: {
      local: {
        get: (key: string | null, cb: (r: Record<string, unknown>) => void) => {
          if (key === null || key === 'mnx_session' || key === 'mnemonics_session') {
            cb({ mnemonics_session: SESSION });
          } else {
            cb({});
          }
        },
        set: (v: Record<string, unknown>, cb?: () => void) => {
          for (const k of Object.keys(v)) storageWrites.push({ key: k, value: v[k] });
          cb?.();
        },
        remove: (_k: string, cb?: () => void) => cb?.()
      }
    },
    runtime: {
      sendMessage: (_m: unknown, cb?: (r: unknown) => void) => cb?.({ ok: true }),
      onMessage: { addListener: () => undefined },
      getURL: (p: string) => p
    },
    tabs: {
      create: (_o: unknown, cb?: (t: unknown) => void) => cb?.({})
    }
  } as unknown as typeof chrome;

  dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8'));
  dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8'));

  return {
    dom,
    calls,
    storageWrites,
    document: dom.window.document
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 420));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 10));
}

describe('extension document upload', () => {
  it('opens a hidden file input scoped to PDF / TXT / Markdown when "Upload Document" is clicked', async () => {
    const h = boot();
    await settle();

    const btn = h.document.querySelector('[data-capture="document"]') as HTMLElement;
    expect(btn, 'dashboard must expose a Upload Document capture button').toBeTruthy();
    btn.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    const input = h.document.getElementById('document-capture-input') as HTMLInputElement | null;
    expect(input, 'document file input must be created on demand').toBeTruthy();
    expect(input!.accept).toMatch(/pdf/);
    expect(input!.accept).toMatch(/text\/plain|text\/markdown/);
  });

  it('POSTs the chosen file to /api/v1/captures/document with the expected multipart fields', async () => {
    // The exact wiring for the change→upload call lives in dashboard.js's
    // `openDocumentCapturePicker`, which jsdom doesn't reliably fire
    // because HTMLInputElement.files is a read-only native getter. To
    // still cover the server contract we exercise it directly: build a
    // FormData the way the dashboard does and call the same
    // `window.uploadDocumentCapture` helper the dashboard uses.
    const h = boot();
    await settle();

    const win = h.dom.window as unknown as {
      uploadDocumentCapture?: (form: FormData, token: string) => Promise<unknown>;
    };
    expect(typeof win.uploadDocumentCapture).toBe('function');

    const form = new h.dom.window.FormData();
    const file = new h.dom.window.File(['PDF-CONTENT'], 'paper.pdf', { type: 'application/pdf' });
    form.append('file', file, 'paper.pdf');
    form.append('type', 'document');
    form.append('title', 'paper');
    form.append('sourceUrl', '');
    form.append('capturedAt', '2026-10-06T00:00:00.000Z');
    form.append('clientRequestId', 'cr-1');

    await win.uploadDocumentCapture!(form, 'AT');

    const docCall = h.calls.find(
      (c) => c.url.includes('/api/v1/captures/document') && c.method === 'POST'
    );
    expect(docCall, 'a document capture POST must have been issued').toBeTruthy();
    // jsdom exposes FormData as `dom.window.FormData`; the test
    // harness's `fetch` stub also runs inside the jsdom realm, so the
    // body the stub sees is the same FormData the helper passed in.
    expect(docCall!.form, 'request body must be multipart FormData')
      .toBeInstanceOf(h.dom.window.FormData);
    const fd = docCall!.form as FormData;
    const keys = Array.from(fd.keys());
    expect(keys).toContain('file');
    expect(keys).toContain('title');
    expect(keys).toContain('type');
    expect(keys).toContain('clientRequestId');
    expect(fd.get('type')).toBe('document');
    expect(docCall!.headers?.Authorization).toBe('Bearer AT');
  });

  it('never writes document bytes to chrome.storage.local', async () => {
    const h = boot();
    await settle();

    const win = h.dom.window as unknown as {
      uploadDocumentCapture?: (form: FormData, token: string) => Promise<unknown>;
    };
    const form = new h.dom.window.FormData();
    const file = new h.dom.window.File(['binary-ish-pdf'], 'big.pdf', { type: 'application/pdf' });
    form.append('file', file, 'big.pdf');
    form.append('type', 'document');
    form.append('title', 'big');
    form.append('clientRequestId', 'cr-2');

    await win.uploadDocumentCapture!(form, 'AT');

    const suspicious = h.storageWrites.filter((w) =>
      /document|pdf|file|blob|bytes/i.test(w.key) || /pdf|application/i.test(String(w.value))
    );
    expect(suspicious.length, 'no chrome.storage.local entries for the file payload').toBe(0);
  });
});