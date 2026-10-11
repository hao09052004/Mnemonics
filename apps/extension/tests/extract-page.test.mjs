/**
 * M1 — page metadata extraction.
 *
 * Exercises the four documented fixture shapes: a product
 * page, a news article, a recipe, and a no-metadata stub. The
 * fifth test pins the 4-second hard timeout: a 1.2 MB body
 * must finish (or fail) within 4.5 seconds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPageMetadata } from '../extraction.js';

function loadDoc(filename) {
  const html = readFileSync(
    new URL(`../../../specs/data/extraction-fixtures/${filename}`, import.meta.url),
    'utf8'
  );
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  return dom.window.document;
}

describe('extractPageMetadata (M1)', () => {
  it('extracts JSON-LD from a product page', async () => {
    const out = await extractPageMetadata(loadDoc('product.html'), 'https://example.com/chair');
    expect(out.ogTitle).toBe('Wooden Chair — A timeless piece');
    expect(out.jsonLd.length).toBeGreaterThan(0);
    expect(out.jsonLd[0]['@type']).toBe('Product');
    expect(out.jsonLd[0].material).toBe('Wood');
    expect(out.contentHash.startsWith('sha256:')).toBe(true);
  });

  it('extracts an Article shape from a news page', async () => {
    const out = await extractPageMetadata(loadDoc('article.html'), 'https://example.com/news');
    expect(out.jsonLd[0]['@type']).toBe('Article');
  });

  it('extracts a Recipe shape', async () => {
    const out = await extractPageMetadata(loadDoc('recipe.html'), 'https://example.com/recipe');
    expect(out.jsonLd[0]['@type']).toBe('Recipe');
    expect(out.jsonLd[0].recipeCuisine).toBe('Italian');
  });

  it('returns a small stub for a no-metadata page', async () => {
    const out = await extractPageMetadata(loadDoc('nometa.html'), 'https://example.com/');
    expect(out.ogTitle).toBe('Simple page');
    expect(out.jsonLd).toEqual([]);
    expect(out.contentHash.startsWith('sha256:')).toBe(true);
  });

  it('completes within 4.5 seconds on a 1.2 MB body', async () => {
    const huge = '<html><body>' + 'x'.repeat(1_200_000) + '</body></html>';
    const dom = new JSDOM(huge, { url: 'https://example.com/huge' });
    const start = Date.now();
    await extractPageMetadata(dom.window.document, 'https://example.com/huge');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4500);
  });
});
