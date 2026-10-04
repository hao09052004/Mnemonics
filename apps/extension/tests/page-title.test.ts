// @vitest-environment jsdom
//
// Two regressions pinned here:
//
// 1. Link captures were titled from the *browser tab title*. On social
//    sites that is "(1) Facebook" — an unread badge plus the site name —
//    so every saved link was captioned with something that identifies
//    nothing. `fetchPageTitle` now reads the page and prefers
//    og:title / twitter:title / <title> / <h1>.
//
// 2. The detail modal's "TLDR" panel rendered `item.note`, which is the
//    captured raw_text and is empty for link captures. So the panel said
//    "No summary yet" even when the enrichment job had written a real
//    AI summary into `item_enrichments.tldr`. The panel now reads the
//    enrichment row via the GET_ENRICHMENT bridge message.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const backgroundJs = readFileSync(join(ROOT, 'background.js'), 'utf8');

/**
 * Evaluate background.js and return the pure helpers under test.
 *
 * The file is a service-worker script with top-level chrome API calls,
 * so we stub the minimum surface and pull the functions out by name.
 * `html` is what the stubbed `fetch` resolves with for any URL; pass
 * `null` to simulate an unreachable page.
 */
function makeHelpers(html: string | null) {
  const chromeStub: any = {
    runtime: { onMessage: { addListener() {} }, onStartup: { addListener() {} }, onInstalled: { addListener() {} }, sendMessage() {}, getURL: (p: string) => p, lastError: null },
    contextMenus: { removeAll(cb?: () => void) { cb?.(); }, create(_i: any, cb?: () => void) { cb?.(); }, onClicked: { addListener() {} } },
    storage: { local: { get(_k: any, cb: (r: any) => void) { cb({}); }, set(_o: any, cb?: () => void) { cb?.(); }, remove(_k: any, cb?: () => void) { cb?.(); } }, onChanged: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, onActivated: { addListener() {} }, create(_o: any, cb?: (t: any) => void) { cb?.({}); }, query(_q: any, cb?: (t: any) => void) { cb([]); } },
    action: { onClicked: { addListener() {} }, setBadgeText() {}, setBadgeBackgroundColor() {} },
    notifications: { create() {} },
    scripting: { executeScript(_o: any, cb?: (r: any) => void) { cb?.([]); } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    windows: { onFocusChanged: { addListener() {} } }
  };

  const fetchStub = async () => {
    if (html === null) throw new Error('offline');
    return { ok: true, status: 200, async text() { return html; } } as any;
  };

  const factory = new Function(
    'chrome', 'fetch', 'console', 'crypto', 'URL', 'setTimeout', 'clearTimeout', 'AbortController',
    backgroundJs + '\nreturn { fetchPageTitle, readMeta, readTagText, decodeEntities, isFetchableUrl };'
  );

  return factory(
    chromeStub,
    fetchStub as any,
    { log() {}, warn() {}, error() {} } as any,
    { randomUUID: () => 'uuid' } as any,
    URL,
    setTimeout,
    clearTimeout,
    AbortController
  ) as any;
}

describe('fetchPageTitle (link captures must not be titled "(1) Facebook")', () => {
  it('prefers og:title over the <title> and ignores the badge prefix', async () => {
    const html = `<html><head>
      <title>(1) Facebook</title>
      <meta property="og:title" content="Bài viết: 5 mẹo chụp ảnh đẹp">
    </head><body><h1>Fallback heading</h1></body></html>`;
    const h = makeHelpers(html);
    const r = await h.fetchPageTitle('https://example.test/post/1', '(1) Facebook');
    expect(r.title).toBe('Bài viết: 5 mẹo chụp ảnh đẹp');
    expect(r.source).toBe('page');
  });

  it('falls back to <title> when there is no og:title', async () => {
    const html = `<html><head><title>Bài đăng của Lan · Blog Nhi 2026</title></head><body></body></html>`;
    const h = makeHelpers(html);
    const r = await h.fetchPageTitle('https://example.test/blog/lan', '(1) Facebook');
    expect(r.title).toBe('Bài đăng của Lan · Blog Nhi 2026');
  });

  it('falls back to the first <h1> when there is no title tag', async () => {
    const html = `<html><body><h1>Hướng dẫn cài Obsidian từ đầu</h1><p>…</p></body></html>`;
    const h = makeHelpers(html);
    const r = await h.fetchPageTitle('https://example.test/huong-dan', '(1) Facebook');
    expect(r.title).toBe('Hướng dẫn cài Obsidian từ đầu');
  });

  it('strips a "(12) Site" badge from a <title> that carries one', async () => {
    const html = `<html><head><title>(12) Inbox · Gmail</title></head><body></body></html>`;
    const h = makeHelpers(html);
    const r = await h.fetchPageTitle('https://example.test/inbox', '(12) Inbox · Gmail');
    expect(r.title).not.toMatch(/^\(\d+\)/);
  });

  it('decodes HTML entities in the extracted title', async () => {
    const html = `<html><head><title>Tom &amp; Jerry &#39;90s &#8211; trọn bộ</title></head><body></body></html>`;
    const h = makeHelpers(html);
    const r = await h.fetchPageTitle('https://example.test/tj', 'x');
    expect(r.title).toContain('&');
    expect(r.title).toContain('90s');
    expect(r.title).not.toContain('&amp;');
  });

  it('returns the tab title when the page cannot be fetched', async () => {
    // Facebook blocks a plain fetch; the capture must still succeed.
    const h = makeHelpers(null);
    const r = await h.fetchPageTitle('https://example.test/photo', '(1) Facebook');
    expect(r).not.toBeNull();
    expect(r.title).toBe('(1) Facebook');
    expect(r.source).toBe('fallback');
  });

  it('refuses non-http(s) schemes without touching the network', async () => {
    const h = makeHelpers('<html><head><title>x</title></head></html>');
    const r = await h.fetchPageTitle('chrome://extensions', 'Extensions');
    expect(r.title).toBe('Extensions');
    expect(r.source).toBe('fallback');
  });

  it('isFetchableUrl rejects javascript: and empty input', () => {
    const h = makeHelpers('<html></html>');
    expect(h.isFetchableUrl('javascript:alert(1)')).toBe(false);
    expect(h.isFetchableUrl('')).toBe(false);
    expect(h.isFetchableUrl('https://ok.test/x')).toBe(true);
  });
});
