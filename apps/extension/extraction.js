/**
 * Bounded in-tab page metadata extraction.
 *
 * Runs in the extension service worker (or, in the test, in
 * jsdom). Takes a parsed DOM `Document` plus the source URL and
 * returns an `ExtractedPage` object suitable for the API's
 * `source_metadata` field.
 *
 * Constraints (spec 0005 §6.4):
 *   * Hard 4-second timeout on the Readability call.
 *   * 100 000-character text cap.
 *   * `null` on any failure — never throws, never blocks the
 *     service worker.
 */
import { parseArticle } from './readability-loader.js';
import { sha256Hex } from './hash.js';

const TIMEOUT_MS = 4000;
const TEXT_CAP = 100_000;

function readMeta(doc, keys) {
  for (const k of keys) {
    const sel = `meta[property="${k}"], meta[name="${k}"]`;
    const el = doc.querySelector(sel);
    if (el && el.content) return el.content;
  }
  return undefined;
}

function readJsonLd(doc) {
  const out = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    let parsed;
    try {
      parsed = JSON.parse(s.textContent);
    } catch (_) {
      continue;
    }
    if (Array.isArray(parsed)) {
      out.push(...parsed);
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed['@graph'])) {
      out.push(...parsed['@graph']);
    } else if (parsed && typeof parsed === 'object') {
      out.push(parsed);
    }
  }
  return out.slice(0, 20);
}

function readCanonical(doc) {
  const link = doc.querySelector('link[rel="canonical"]');
  return link && link.href ? link.href : undefined;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export async function extractPageMetadata(doc, url) {
  const ogTitle = readMeta(doc, ['og:title', 'twitter:title']);
  const ogDescription = readMeta(doc, ['og:description', 'twitter:description']);
  const ogImage = readMeta(doc, ['og:image']);
  const canonicalUrl = readCanonical(doc) || url;
  const jsonLd = readJsonLd(doc);

  let article = null;
  try {
    // Readability mutates the document. The caller is expected to
    // pass a clone; we clone again here so the extraction is
    // side-effect-free even if a caller forgets.
    const cloned = doc.cloneNode(true);
    const parsed = await withTimeout(
      Promise.resolve(parseArticle(cloned)),
      TIMEOUT_MS
    );
    if (parsed && parsed.textContent) {
      const text = parsed.textContent.slice(0, TEXT_CAP);
      article = {
        title: parsed.title,
        byline: parsed.byline,
        excerpt: parsed.excerpt,
        contentHtml: parsed.content,
        textContent: text
      };
    }
  } catch (_) {
    article = null;
  }

  const textSource = article ? article.textContent : ogDescription || '';
  const contentHash = await sha256Hex(textSource);

  return {
    ogTitle,
    ogDescription,
    ogImage,
    canonicalUrl,
    jsonLd,
    article,
    contentHash: 'sha256:' + contentHash.slice(0, 32)
  };
}
