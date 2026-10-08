/**
 * Tiny PDF text fixture used by the document extraction test suite.
 *
 * We use `pdf-lib` (devDependency only) to produce a real, valid PDF
 * at runtime. The resulting bytes are guaranteed to be readable by
 * `pdf-parse` because pdf-lib emits standard-conformant PDFs, and
 * hand-building a PDF that pdfjs accepts is fragile.
 *
 * The resulting bytes contain exactly the seed text on a single page,
 * which is the contract the document-extract tests assert against.
 */

import { Buffer } from 'node:buffer';
// `pdf-lib` is a devDependency only — production installs skip it. The
// type declaration is stripped at build time so the API bundle
// doesn't accidentally include it.
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const PDF_SEED = 'Mnemonics document capture integration test. Semantic search should find this PDF.';

/** Build the test fixture PDF as a Buffer. */
export async function buildFixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText(PDF_SEED, { x: 50, y: 750, size: 12, font });
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/** Plain-text fixture used by the document extraction suite. */
export const SAMPLE_TXT = (
  'Mnemonics document capture integration test.\n' +
  'Semantic search should find this TXT.\n'
);

/** Markdown fixture. Treated as opaque text by the extractor. */
export const SAMPLE_MD = (
  '# Mnemonics document capture\n\n' +
  'Semantic search should find this Markdown.\n'
);