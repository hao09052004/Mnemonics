// @vitest-environment jsdom
//
// The detail modal's "TLDR" panel used to render `item.note`, which is
// the captured raw_text and is empty for link captures — so it said
// "No summary yet" for every link even though the enrichment job had
// written a real summary to `item_enrichments.tldr`.
//
// These tests drive the real dashboard in jsdom and assert the panel
// shows the AI summary fetched over the GET_ENRICHMENT bridge, plus the
// pending / failed / empty states.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

interface Harness {
  dom: JSDOM;
  sent: any[];
  enrichment: any;
  document: Document;
}

function loadDashboard(enrichment: any = null): Harness {
  const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
    .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
  const dashboardJs = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
  const apiClientJs = readFileSync(join(ROOT, 'api-client.js'), 'utf8');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  const harness: Harness = { dom, sent: [], enrichment, document: dom.window.document };

  const item = {
    id: 'i1',
    kind: 'link',
    title: 'Bài viết: 5 mẹo chụp ảnh đẹp',
    source_url: 'https://example.test/post/1',
    raw_text: '',
    is_favorite: false,
    captured_at: '2026-10-04T00:00:00Z',
    tags: []
  };

  dom.window.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/v1/items')) {
      return { ok: true, status: 200, json: async () => ({ data: { items: [item], total: 1, limit: 50, offset: 0 } }) } as any;
    }
    if (u.includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { spaces: [], user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999 } } })
    } as any;
  });

  dom.window.chrome = {
    storage: {
      local: {
        get(_k: string, cb: (r: any) => void) {
          cb({ mnemonics_session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999, user: { id: 'u1', email: 'a@b.co' } } });
        },
        set(_o: any, cb?: () => void) { if (cb) cb(); },
        remove(_k: string, cb?: () => void) { if (cb) cb(); }
      }
    },
    runtime: {
      sendMessage(msg: any, cb?: (r: any) => void) {
        harness.sent.push(msg);
        if (!cb) return;
        if (msg.type === 'GET_ENRICHMENT') {
          cb({ ok: true, data: harness.enrichment });
          return;
        }
        cb({ ok: true, item: { id: msg.itemId } });
      },
      onMessage: { addListener() {} },
      getURL(p: string) { return p; }
    },
    tabs: { create(_o: any, cb?: (t: any) => void) {} }
  } as any;

  (dom.window as any).confirm = () => true;

  try { dom.window.eval(apiClientJs); } catch { /* ignore */ }
  try { dom.window.eval(dashboardJs); } catch { /* ignore */ }
  return harness;
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function click(dom: JSDOM, selector: string) {
  const el = dom.window.document.querySelector(selector) as HTMLElement;
  if (!el) throw new Error(`selector not found: ${selector}`);
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function tldrPanel(h: Harness) {
  return h.document.querySelector('[data-tldr-state]');
}

describe('detail TLDR panel reads the AI summary, not the raw capture', () => {
  it('requests the enrichment row when a card is opened', async () => {
    const h = loadDashboard({ tldr: 'Bài viết tổng hợp 5 mẹo chụp ảnh.', tldrStatus: 'ready', tldrSource: 'heuristic' });
    await settle();

    click(h.dom, '.mnx-card[data-memory-id="i1"]');
    await settle();

    const req = h.sent.find((m) => m.type === 'GET_ENRICHMENT');
    expect(req, 'the modal must ask for the enrichment row').toBeTruthy();
    expect(req!.itemId).toBe('i1');
  });

  it('renders the AI TLDR instead of the empty raw_text', async () => {
    const h = loadDashboard({
      tldr: 'Bài viết tổng hợp 5 mẹo chụp ảnh đẹp.',
      tldrStatus: 'ready',
      tldrSource: 'cloud_ai',
      tldrModel: 'gemini-3.8-flash'
    });
    await settle();

    click(h.dom, '.mnx-card[data-memory-id="i1"]');
    await settle();

    const panel = tldrPanel(h);
    expect(panel, 'the TLDR panel must be present').toBeTruthy();
    expect(panel!.getAttribute('data-tldr-state')).toBe('ready');
    expect(panel!.textContent).toContain('Bài viết tổng hợp 5 mẹo chụp ảnh đẹp.');
    // The old code rendered "No summary yet." here because `note` is
    // empty for a link capture.
    expect(panel!.textContent).not.toContain('No summary yet');
  });

  it('labels a user-written TLDR so it is not mistaken for AI output', async () => {
    const h = loadDashboard({
      tldr: 'Ghi chú của tôi.',
      tldrStatus: 'ready',
      tldrSource: 'user',
      tldrModel: null
    });
    await settle();
    click(h.dom, '.mnx-card[data-memory-id="i1"]');
    await settle();
    expect(tldrPanel(h)!.textContent).toContain('bạn đã viết');
  });

  it('says it is still generating when the job has not run', async () => {
    // A 404 / no enrichment row is normal: the job is async.
    const h = loadDashboard(null);
    await settle();
    click(h.dom, '.mnx-card[data-memory-id="i1"]');
    await settle();

    const panel = tldrPanel(h);
    expect(panel!.getAttribute('data-tldr-state')).toBe('pending');
    expect(panel!.textContent).toContain('Đang tạo tóm tắt');
  });

  it('reports a failed summary honestly instead of hiding it', async () => {
    const h = loadDashboard({ tldr: null, tldrStatus: 'failed', tldrSource: 'pending' });
    await settle();
    click(h.dom, '.mnx-card[data-memory-id="i1"]');
    await settle();

    const panel = tldrPanel(h);
    expect(panel!.getAttribute('data-tldr-state')).toBe('failed');
    expect(panel!.textContent).toContain('Không tạo được tóm tắt');
  });

  it('falls back to the captured text when there is no AI summary', async () => {
    // Same fixture but with raw_text present, so the panel has a body
    // to show even without an enrichment row.
    const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
      .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test-id/mnemonics-dashboard.html', pretendToBeVisual: true });
    const sent: any[] = [];
    const item = { id: 'i1', kind: 'text', title: 'Ghi chú nhanh', raw_text: 'Nội dung đã bắt.', captured_at: '2026-10-04T00:00:00Z', tags: [] };
    dom.window.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/api/v1/items')) return { ok: true, status: 200, json: async () => ({ data: { items: [item], total: 1, limit: 50, offset: 0 } }) } as any;
      if (u.includes('/api/v1/search')) return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
      return { ok: true, status: 200, json: async () => ({ data: { spaces: [], user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999 } } }) } as any;
    }) as any;
    dom.window.chrome = {
      storage: { local: { get(_k: string, cb: (r: any) => void) { cb({ mnemonics_session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999, user: { id: 'u1', email: 'a@b.co' } } }); }, set(_o: any, cb?: () => void) { cb?.(); }, remove(_k: string, cb?: () => void) { cb?.(); } } },
      runtime: {
        sendMessage(msg: any, cb?: (r: any) => void) {
          sent.push(msg);
          if (msg.type === 'GET_ENRICHMENT') { cb?.({ ok: true, data: null }); return; }
          cb?.({ ok: true });
        },
        onMessage: { addListener() {} },
        getURL: (p: string) => p
      },
      tabs: { create(_o: any, cb?: (t: any) => void) {} }
    } as any;
    (dom.window as any).confirm = () => true;
    try { dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8')); } catch { /* ignore */ }
    try { dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8')); } catch { /* ignore */ }

    await settle();
    click(dom, '.mnx-card[data-memory-id="i1"]');
    await settle();

    const panel = dom.window.document.querySelector('[data-tldr-state]');
    expect(panel!.getAttribute('data-tldr-state')).toBe('fallback');
    expect(panel!.textContent).toContain('Nội dung đã bắt.');
    expect(panel!.textContent).toContain('nguyên văn');
  });
});
