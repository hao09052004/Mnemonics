/**
 * Web-side page metadata extraction.
 *
 * Mirrors `apps/extension/extraction.js` but uses the browser's
 * built-in `DOMParser` instead of JSDOM. Returns the same
 * `ExtractedPage` shape so the API call is identical across
 * web and extension.
 *
 * Added in M1 of spec 0005. The implementation is best-effort
 * and never throws; a hostile page simply produces a thin
 * `ExtractedPage` with the OG title and a content hash.
 */

const TIMEOUT_MS = 4000;
const TEXT_CAP = 100_000;

export type ExtractedPage = {
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  canonicalUrl?: string;
  jsonLd: Record<string, unknown>[];
  article: {
    title?: string;
    byline?: string;
    excerpt?: string;
    contentHtml?: string;
    textContent?: string;
  } | null;
  contentHash: string;
};

function readMeta(doc: Document, keys: string[]): string | undefined {
  for (const k of keys) {
    const el = doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`);
    if (el && el.content) return el.content;
  }
  return undefined;
}

function readJsonLd(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of Array.from(scripts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s.textContent || '');
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) {
      out.push(...(parsed as Record<string, unknown>[]));
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as { '@graph'?: unknown };
      if (Array.isArray(obj['@graph'])) {
        out.push(...(obj['@graph'] as Record<string, unknown>[]));
      } else {
        out.push(obj);
      }
    }
  }
  return out.slice(0, 20);
}

function readCanonical(doc: Document): string | undefined {
  const link = doc.querySelector('link[rel="canonical"]');
  return link && link.href ? link.href : undefined;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(input)
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '0'.repeat(64);
}

export async function extractPageMetadata(
  doc: Document,
  url: string
): Promise<ExtractedPage> {
  const ogTitle = readMeta(doc, ['og:title', 'twitter:title']);
  const ogDescription = readMeta(doc, ['og:description', 'twitter:description']);
  const ogImage = readMeta(doc, ['og:image']);
  const canonicalUrl = readCanonical(doc) || url;
  const jsonLd = readJsonLd(doc);

  // Web does not bundle a Readability implementation in M1; the
  // article body is left null and the M2 classifier will rely
  // on the JSON-LD + OG fields. M3 can add Readability via a
  // server-side helper if the dashboard needs it.
  const article = null;

  const textSource = ogDescription || '';
  const hash = await sha256Hex(textSource);

  return {
    ogTitle,
    ogDescription,
    ogImage,
    canonicalUrl,
    jsonLd,
    article,
    contentHash: 'sha256:' + hash.slice(0, 32)
  };
}
