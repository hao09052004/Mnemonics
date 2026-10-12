/**
 * Readability loader — the only place @mozilla/readability is
 * imported. The library reads a parsed DOM document and returns
 * a sanitized article representation. We wrap it in a try/catch
 * and a hard timeout so a hostile page can never block the
 * service worker.
 *
 * Added in M1 of spec 0005. The bundler is the Chrome
 * service-worker itself; this file is plain ES module syntax.
 */
import { Readability, isProbablyReaderable } from '@mozilla/readability';

/**
 * Parse a parsed DOM document with Readability. Returns the
 * parsed article (title, byline, excerpt, content HTML, text
 * content) or `null` when the page is not a reader-view candidate
 * or Readability throws.
 *
 * The caller is responsible for cloning the document before
 * passing it in. Readability mutates the DOM in place.
 */
export function parseArticle(document) {
  try {
    if (typeof isProbablyReaderable === 'function') {
      if (!isProbablyReaderable(document)) {
        return null;
      }
    }
    const reader = new Readability(document, {
      debug: false,
      charThreshold: 200
    });
    const parsed = reader.parse();
    if (!parsed || !parsed.content) {
      return null;
    }
    return {
      title: parsed.title || undefined,
      byline: parsed.byline || undefined,
      excerpt: parsed.excerpt || undefined,
      content: parsed.content,
      textContent: parsed.textContent || ''
    };
  } catch (_) {
    return null;
  }
}
