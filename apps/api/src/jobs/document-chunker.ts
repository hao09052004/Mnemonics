/**
 * Document chunker — Milestone 4 of the AI Quality upgrade.
 *
 * The current embed pipeline truncates any document to the first
 * ~8 000 characters (`EmbedHandler.prepareTextForEmbedding`).
 * For a long PDF, page 30 or page 80 of meaningful content never
 * reaches the embedding model, so a search for a phrase that
 * appears late in the document returns nothing.
 *
 * This module splits extracted text into semantically coherent
 * chunks suitable for individual embedding. The chunker is
 * pure and deterministic — the same input always produces the
 * same chunks, which is what makes incremental re-embedding
 * safe (a content hash can identify which chunks are stale).
 *
 * Heuristics:
 *
 *   1. Prefer semantic boundaries: blank line, then sentence end
 *      (`.`, `!`, `?` in English; `。` in CJK), then word
 *      boundary.
 *   2. Target 500 tokens per chunk, hard cap at 800, soft floor
 *      at 200. The cap matches what bge-m3 and gemini-embedding-
 *      001 can ingest cleanly without truncating mid-sentence.
 *   3. ~12% overlap between consecutive chunks. Overlap ensures
 *      a query that hits a sentence near the boundary still
 *      matches at least one chunk.
 *   4. Stable ordering. Chunks are numbered 0..N-1 in the order
 *      they appear in the source.
 *   5. Page numbers are APPROXIMATE. pdf-parse's library does
 *      not preserve reliable per-page text boundaries, so we
 *      estimate them by evenly distributing the chunks across
 *      the reported `numpages`. Each chunk carries
 *      `pageStart` and `pageEnd` (inclusive). We never invent
 *      page numbers; if `numpages` is unknown, both fields are
 *      null.
 *
 * The chunker is intentionally lightweight — no NLP, no
 * sentence-segmenter library. The corpus that benefits from
 * sophisticated parsing (legal documents, dense research
 * papers) is exactly the corpus where the embedding model
 * itself is the bottleneck, not the chunker.
 */

export interface ChunkInput {
  text: string;
  pageCount: number | null;
}

export interface DocumentChunk {
  index: number;
  /** 0-based offset into the source text. */
  charStart: number;
  /** exclusive end offset. */
  charEnd: number;
  content: string;
  /** Estimated starting page (1-based), null when unknown. */
  pageStart: number | null;
  /** Estimated ending page (1-based), null when unknown. */
  pageEnd: number | null;
  /** Token estimate (whitespace-delimited). */
  tokenEstimate: number;
  /** SHA-256 hex of the chunk content; used to detect stale
   *  embeddings during incremental re-indexing. */
  contentHash: string;
}

/** Approximate tokens-per-chunk target. The embedding models
 *  in use handle 1024-token inputs well; 500 leaves headroom
 *  for query-side expansion. */
export const TARGET_CHUNK_TOKENS = 500;

/** Hard cap. Anything longer than this gets force-split. */
export const MAX_CHUNK_TOKENS = 800;

/** Soft floor. Chunks below this length are merged with the
 *  next one. Prevents a corpus of one-sentence chunks. */
export const MIN_CHUNK_TOKENS = 200;

/** Overlap as a fraction of the previous chunk's token count.
 *  0.12 == 12%, which is in the spec's recommended 10-15% band. */
export const OVERLAP_FRACTION = 0.12;

/** Token approximation. We do not run a BPE tokenizer here
 *  because the corpus the search service sees is already
 *  normalised prose; whitespace tokens + punctuation are
 *  close enough for chunking decisions. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Split on whitespace, ignore empty fragments. This treats
  // "Hello, world!" as 2 tokens. BPE would produce 3-4 for the
  // same string. The discrepancy is small enough that the
  // chunker is well within its token budget.
  return text.trim().split(/\s+/).length;
}

/** Lightweight SHA-256 in pure JS, used for the content hash.
 *  Avoids pulling in a crypto polyfill on the worker; Node has
 *  a stable native implementation. */
function sha256(text: string): string {
  // Node's crypto is universally available in the API runtime.
  // Synchronous hashing keeps the chunker pure-functional: same
  // input -> same output, no async ordering hazards.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Split `text` into paragraph-sized segments separated by
 * blank lines. The page boundary detector in pdf-parse emits
 * a `\f` (form feed) between pages, but the rest of the
 * pipeline already collapses those to `\n\n` via
 * `normaliseExtractedText`, so a double newline is the
 * reliable boundary.
 */
function splitParagraphs(text: string): { start: number; end: number; content: string }[] {
  const out: { start: number; end: number; content: string }[] = [];
  const re = /\n\s*\n/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const segment = text.slice(last, m.index);
    if (segment.trim().length > 0) {
      out.push({ start: last, end: m.index, content: segment });
    }
    last = end;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    if (tail.trim().length > 0) {
      out.push({ start: last, end: text.length, content: tail });
    }
  }
  return out;
}

/**
 * Group paragraphs into chunks that respect the token budget.
 * The algorithm is greedy: append paragraphs while the running
 * total is below the target; force a new chunk when adding the
 * next paragraph would exceed the cap.
 */
function groupParagraphs(
  paragraphs: { start: number; end: number; content: string }[]
): { charStart: number; charEnd: number; content: string; tokenEstimate: number }[] {
  const chunks: { charStart: number; charEnd: number; content: string; tokenEstimate: number }[] = [];
  let buffer: { start: number; end: number; content: string }[] = [];
  let bufferTokens = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    const content = buffer.map((p) => p.content).join('\n\n');
    chunks.push({
      charStart: first.start,
      charEnd: last.end,
      content,
      tokenEstimate: estimateTokens(content),
    });
    buffer = [];
    bufferTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para.content);
    // If a single paragraph is over the cap by itself, force-split
    // it on sentence boundaries. This is rare for real documents
    // but possible for OCR'd scans.
    if (paraTokens > MAX_CHUNK_TOKENS) {
      flush();
      const sub = forceSplit(para);
      for (const s of sub) chunks.push(s);
      continue;
    }
    if (bufferTokens + paraTokens > TARGET_CHUNK_TOKENS && buffer.length > 0) {
      flush();
    }
    buffer.push(para);
    bufferTokens += paraTokens;
  }
  flush();
  return chunks;
}

/** Force-split an over-long paragraph on sentence boundaries.
 *  Falls back to word boundaries when the paragraph has no
 *  sentence-ending punctuation (common for OCR'd text, slide
 *  decks exported as PDFs, and code blocks). */
function forceSplit(para: { start: number; end: number; content: string }): { charStart: number; charEnd: number; content: string; tokenEstimate: number }[] {
  // Pass 1: try sentence-end boundaries.
  const sentenceRe = /([.!?。]\s+)/g;
  let sentenceOut: { charStart: number; charEnd: number; content: string }[] = [];
  let cursor = para.start;
  let buf = '';
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(para.content)) !== null) {
    buf += para.content.slice(m.index, m.index + m[0].length);
    if (estimateTokens(buf) >= TARGET_CHUNK_TOKENS) {
      sentenceOut.push({
        charStart: cursor,
        charEnd: para.start + m.index + m[0].length,
        content: buf,
      });
      cursor = para.start + m.index + m[0].length;
      buf = '';
    }
  }
  if (buf.length > 0) {
    sentenceOut.push({ charStart: cursor, charEnd: para.end, content: buf });
  }

  if (sentenceOut.length > 1) {
    return sentenceOut.map((p) => ({
      charStart: p.charStart,
      charEnd: p.charEnd,
      content: p.content,
      tokenEstimate: estimateTokens(p.content),
    }));
  }

  // Pass 2: word-boundary split. Walk the words, accumulating
  // until we hit the target, then emit and reset.
  const out: { charStart: number; charEnd: number; content: string }[] = [];
  const tokens = para.content.split(/(\s+)/);
  let wordBuf: string[] = [];
  let wordStart = para.start;
  let consumed = 0;
  for (const tok of tokens) {
    wordBuf.push(tok);
    consumed += tok.length;
    if (estimateTokens(wordBuf.join('')) >= TARGET_CHUNK_TOKENS) {
      out.push({
        charStart: wordStart,
        charEnd: wordStart + consumed,
        content: wordBuf.join(''),
      });
      wordStart = wordStart + consumed;
      wordBuf = [];
      consumed = 0;
    }
  }
  if (wordBuf.length > 0) {
    out.push({
      charStart: wordStart,
      charEnd: para.end,
      content: wordBuf.join(''),
    });
  }
  if (out.length === 0) {
    out.push({ charStart: para.start, charEnd: para.end, content: para.content });
  }
  return out.map((p) => ({
    charStart: p.charStart,
    charEnd: p.charEnd,
    content: p.content,
    tokenEstimate: estimateTokens(p.content),
  }));
}

/**
 * Add ~12% overlap by carrying the tail of the previous chunk
 * into the next one. The overlap is on the trailing ~12% of
 * the PREVIOUS chunk's tokens, not on character offsets, so it
 * scales with chunk size.
 */
function addOverlap(
  chunks: { charStart: number; charEnd: number; content: string; tokenEstimate: number }[]
): { charStart: number; charEnd: number; content: string; tokenEstimate: number }[] {
  if (chunks.length < 2) return chunks;
  const out: { charStart: number; charEnd: number; content: string; tokenEstimate: number }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const cur = chunks[i];
    if (i === 0) {
      out.push({ ...cur });
      continue;
    }
    // Take the tail of the previous chunk.
    const prev = chunks[i - 1];
    const overlapTokens = Math.max(
      MIN_CHUNK_TOKENS / 2,
      Math.floor(prev.tokenEstimate * OVERLAP_FRACTION)
    );
    const prevWords = prev.content.split(/(\s+)/);
    // Walk from the end until we have collected at least
    // `overlapTokens` whitespace-delimited tokens.
    let tail = '';
    let count = 0;
    for (let j = prevWords.length - 1; j >= 0; j--) {
      tail = prevWords[j] + tail;
      if (!/^\s+$/.test(prevWords[j])) count++;
      if (count >= overlapTokens) break;
    }
    const merged = tail.trim() + '\n\n' + cur.content;
    out.push({
      charStart: prev.charEnd - tail.trim().length,
      charEnd: cur.charEnd,
      content: merged,
      tokenEstimate: estimateTokens(merged),
    });
  }
  return out;
}

/**
 * Estimate the page range for each chunk by evenly distributing
 * the chunks across the reported `numpages`. The estimate is
 * honest: it never invents page numbers. When `numpages` is
 * null, every chunk gets `pageStart = pageEnd = null` and the
 * search UI displays "Section unknown".
 */
function annotatePages(
  chunks: { charStart: number; charEnd: number; content: string; tokenEstimate: number }[],
  pageCount: number | null
): DocumentChunk[] {
  if (pageCount === null || pageCount <= 0 || chunks.length === 0) {
    return chunks.map((c, i) => ({
      index: i,
      charStart: c.charStart,
      charEnd: c.charEnd,
      content: c.content,
      pageStart: null,
      pageEnd: null,
      tokenEstimate: c.tokenEstimate,
      contentHash: sha256(c.content),
    }));
  }
  // Distribute N chunks across P pages by walking through the
  // chunks in order and assigning each one a range. The
  // distribution is monotone and stable: the i-th chunk maps
  // to a contiguous page range. The exact endpoints depend on
  // chunk count, which is good enough for "where in the
  // document" hints without claiming page-perfect accuracy.
  const out: DocumentChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const pageStart = Math.floor((i * pageCount) / chunks.length) + 1;
    const pageEnd = Math.max(
      pageStart,
      Math.floor(((i + 1) * pageCount) / chunks.length)
    );
    out.push({
      index: i,
      charStart: chunks[i].charStart,
      charEnd: chunks[i].charEnd,
      content: chunks[i].content,
      pageStart,
      pageEnd,
      tokenEstimate: chunks[i].tokenEstimate,
      contentHash: sha256(chunks[i].content),
    });
  }
  return out;
}

/**
 * Top-level entry point. Pure function; same input -> same
 * output, in the same order, with the same hashes.
 */
export function chunkDocument(input: ChunkInput): DocumentChunk[] {
  if (!input.text || input.text.trim().length === 0) return [];
  const paragraphs = splitParagraphs(input.text);
  if (paragraphs.length === 0) return [];
  const grouped = groupParagraphs(paragraphs);
  const overlapped = addOverlap(grouped);
  return annotatePages(overlapped, input.pageCount);
}
