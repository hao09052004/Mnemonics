// Regression test: every CSS/asset file referenced by the extension
// HTML pages must be listed in `web_accessible_resources` so Chrome
// doesn't 404 them when the page is opened in a new tab.
//
// Triggered by the 2026-10-04 incident where styles/tokens.css was
// 404'ing in the dashboard because the manifest didn't list it.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';

const EXT = join(__dirname, '..');
const HTML_FILES = ['mnemonics-dashboard.html', 'screenshot-cropper.html', 'original-image.html'];

interface Manifest {
  web_accessible_resources: Array<{ resources: string[]; matches: string[] }>;
}

const manifest: Manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const warPatterns: string[] = manifest.web_accessible_resources.flatMap((w) => w.resources);

function matchesWar(resourcePath: string): boolean {
  return warPatterns.some((p) => {
    if (p.includes('*')) {
      // Translate glob to regex.
      const re = new RegExp('^' + p.replace(/[.+^$|()[\]{}\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(resourcePath);
    }
    return p === resourcePath;
  });
}

function collectAssets(htmlPath: string): string[] {
  const html = readFileSync(join(EXT, htmlPath), 'utf8');
  const out = new Set<string>();
  // <link rel="stylesheet" href="...">
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) {
    out.add(m[1].split('?')[0].split('#')[0]);
  }
  // <script src="...">
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    out.add(m[1].split('?')[0].split('#')[0]);
  }
  // <img src="..."> and <source src="...">
  for (const m of html.matchAll(/<(?:img|source)[^>]+src=["']([^"']+)["']/gi)) {
    out.add(m[1].split('?')[0].split('#')[0]);
  }
  // CSS @import url("...") and url("...")
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const [, body] of styleBlocks) {
    for (const m of body.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']/gi)) {
      out.add(m[1]);
    }
    for (const m of body.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
      out.add(m[1]);
    }
  }
  return Array.from(out).filter((s) => !s.startsWith('data:') && !s.startsWith('blob:') && !/^https?:/.test(s));
}

describe('manifest web_accessible_resources coverage', () => {
  for (const html of HTML_FILES) {
    it(`${html}: every referenced local asset is in web_accessible_resources`, () => {
      const assets = collectAssets(html);
      const missing = assets.filter((a) => !matchesWar(a));
      expect(missing, `${html} references assets missing from web_accessible_resources: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('web_accessible_resources glob styles/*.css is intentional', () => {
    expect(warPatterns).toContain('styles/*.css');
  });
});