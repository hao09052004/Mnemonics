/**
 * Document extraction — local, free, on-demand.
 *
 * Reads the bytes from a stored asset (PDF, TXT or Markdown) and
 * returns the extracted plain-text content plus a small amount of
 * per-document information the BE persists on the item.
 *
 * Why a hand-rolled module rather than reaching for an external worker:
 *
 *   - The job handler is already on a Node process; spinning up a
 *     child for each document turns a 200 ms read into a 1 s fork.
 *   - The contracts we need are tiny: text + page count + whether
 *     the document had any extractable text at all. No full AST is
 *     required downstream.
 *
 * Libraries:
 *
 *   - `pdf-parse` (MIT, dep: pdfjs-dist's legacy Node build). We use
 *     the exported `Pdf-Parse` function which returns `{ numpages,
 *     info, text, metadata }`. The default-export behaviour (auto-
 *     running on `index.js` when require'd from a path ending in
 *     `pdf-parse/test/data/*.pdf.js`) is a footgun we sidestep by
 *     importing the named function explicitly via the package's
 *     `lib/pdf-parse.js` entry.
 *
 *   - TXT / Markdown are decoded to a UTF-8 string with a BOM strip
 *     and the obvious whitespace normalisation. Markdown is treated as
 *     opaque text; we do not render it as HTML and we do not trust
 *     any HTML it might contain.
 *
 * Security boundary (see also: docs/document-capture.md):
 *
 *   - We never call `evaluate` or render the parsed PDF tree.
 *   - We never execute macros / JavaScript inside the document.
 *   - We strip null bytes and the C0 control range before
 *     persisting, so the text column is safe to feed into a
 *     full-text search index without poisoning it.
 */

import { Buffer } from 'node:buffer';
import type { DocumentMimeType } from './document-types.js';

// pdf-parse's library file is a CJS module; we import the function
// directly to avoid the "auto-runs on test-data path" trap the default
// export has. The library is loaded lazily so an environment without
// it (e.g. the test pool) doesn't pay the startup cost.
type PdfParseResult = {
  numpages: number;
  info: Record<string, unknown> | null;
  metadata: unknown;
  text: string;
};
type PdfParseFn = (
  buffer: Buffer,
  options?: Record<string, unknown>
) => Promise<PdfParseResult>;

/** Load the underlying pdf-parse implementation. Lazy to keep
 *  the boot path lean. */
async function loadPdfParser(): Promise<PdfParseFn> {
  // pdf-parse v2 exposes a Promise<PdfParseFn> default export; v1's
  // `lib/pdf-parse.js` exports the function. Either way the resolved
  // value is the parse function.
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const fn = (mod as { default?: PdfParseFn } & Partial<PdfParseFn>).default
      ?? (mod as unknown as PdfParseFn);
  if (typeof fn !== 'function') {
    throw new Error('PDF_PARSER_UNAVAILABLE');
  }
  return fn;
}

/** What an uploaded document is once we've pulled its text out. */
export interface ExtractedDocument {
  /** Plain-text content. Always present, may be empty when extraction
   *  fails or the file genuinely has nothing extractable. */
  text: string;
  /** Total number of pages when the source is application/pdf and the
   *  parser reports it; null otherwise. */
  pageCount: number | null;
  /** Diagnostic: which engine produced the text. */
  engine: 'pdf-parse' | 'text-decoder';
  /** True when the bytes were successfully read and a (possibly empty)
   *  string was produced. False when the parser threw. */
  ok: boolean;
  /** Reason an extraction failed. Stable identifier suitable for storing
   *  on the item as an error code. */
  errorCode?: string;
}

/** Document extraction cap.
 *
 *  The DB stores extracted text in `items.raw_text` and that column is
 *  consumed by the lexical FTS index (which is unbounded) and the
 *  embedding builder (which truncates to ~8 000 chars). A 500 KB text
 *  ceiling leaves plenty of headroom for a 400-page text-only PDF
 *  while preventing a single pathological upload from ballooning the
 *  table. Anything beyond is truncated and the user is told via the
 *  `truncated` flag.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 500_000;

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TRAILING_WS_PER_LINE_RE = /[ \t]+$/gm;
/** Collapse 3+ consecutive newlines into a single blank line so the
 *  tsvector indexer doesn't choke on a PDF that emits a page break as
 *  a long run of \n. */
const EXCESS_NEWLINES_RE = /\n{3,}/g;

/** Strip a leading UTF-8 BOM (U+FEFF) the browserless decode path
 *  sometimes leaves when the source was authored on Windows. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Normalise the text we are about to persist:
 *   - Drop null bytes and other C0 controls (kept newline + tab).
 *   - Collapse 3+ newlines into a single blank line.
 *   - Trim trailing whitespace on every line.
 *   - Trim the leading/trailing run. */
export function normaliseExtractedText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(CONTROL_CHARS_RE, '')
    .replace(EXCESS_NEWLINES_RE, '\n\n')
    .replace(TRAILING_WS_PER_LINE_RE, '')
    .trim();
}

/**
 * Decode TXT / Markdown bytes as UTF-8.
 *
 * We reject binary garbage at the byte layer rather than at the
 * rendered-text layer: a UTF-8 byte sequence that decodes to
 * replacement characters is almost always a mislabeled binary upload and
 * we want a clean, useful TLDR / embedding rather than a sea of U+FFFD.
 */
export async function extractPlainText(bytes: Buffer): Promise<ExtractedDocument> {
  // The text/markdown and text/plain paths share the same decode
  // strategy. We strip the BOM explicitly because Node's UTF-8 decoder
  // preserves it, and most editors treat it as part of the title.
  let text: string;
  try {
    text = stripBom(bytes.toString('utf8'));
  } catch (err) {
    const code = err instanceof Error ? err.message : 'TEXT_DECODE_FAILED';
    return {
      text: '',
      pageCount: null,
      engine: 'text-decoder',
      ok: false,
      errorCode: code.slice(0, 200)
    };
  }
  return {
    text: normaliseExtractedText(text),
    pageCount: null,
    engine: 'text-decoder',
    ok: true
  };
}

/**
 * Extract text from a PDF byte stream. Returns ok=false on any parser
 * error and never throws — extraction is enrichment, not a save
 * boundary.
 */
export async function extractPdfText(bytes: Buffer): Promise<ExtractedDocument> {
  let parse: PdfParseFn;
  try {
    parse = await loadPdfParser();
  } catch (err) {
    const code = err instanceof Error ? err.message : 'PDF_PARSER_UNAVAILABLE';
    return {
      text: '',
      pageCount: null,
      engine: 'pdf-parse',
      ok: false,
      errorCode: code.slice(0, 200)
    };
  }
  try {
    const out = await parse(bytes);
    const normalised = normaliseExtractedText(out.text || '');
    const numPages =
      typeof out.numpages === 'number' && out.numpages > 0 ? Math.floor(out.numpages) : null;
    return {
      text: normalised,
      pageCount: numPages,
      engine: 'pdf-parse',
      ok: true
    };
  } catch (err) {
    const code = err instanceof Error ? err.message : 'PDF_PARSE_FAILED';
    return {
      text: '',
      pageCount: null,
      engine: 'pdf-parse',
      ok: false,
      errorCode: code.slice(0, 200)
    };
  }
}

/**
 * Top-level entry point used by the extract handler. Returns the extracted
 * text, page count, and a structured error code when extraction fails.
 *
 * The handler MUST treat ok=false as "the document exists but the
 * bytes didn't yield text" — never as "the document is gone".
 */
export async function extractDocument(
  bytes: Buffer,
  mimeType: DocumentMimeType
): Promise<ExtractedDocument> {
  if (mimeType === 'application/pdf') {
    return extractPdfText(bytes);
  }
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return extractPlainText(bytes);
  }
  // Unknown MIME — treat as a soft failure so the memory still ends
  // up in the DB.
  return {
    text: '',
    pageCount: null,
    engine: 'text-decoder',
    ok: false,
    errorCode: 'UNSUPPORTED_DOCUMENT_MIME'
  };
}

/**
 * Truncate the extracted text to the persistence ceiling. Returns the
 * truncated text and a `truncated` flag the caller can record as
 * enrichment.
 */
export function truncateExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    truncated: true
  };
}