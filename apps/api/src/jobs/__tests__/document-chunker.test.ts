/**
 * Document chunker tests — Milestone 4 §22.
 *
 * Locks in the contract the embed handler relies on:
 *
 *   1. The chunker is pure: same input -> same output.
 *   2. The token budget is respected (target 500, cap 800,
 *      floor 200). A paragraph that exceeds the cap by itself
 *      is force-split on sentence boundaries.
 *   3. The output is stable and ordered: chunk_index runs 0..N-1.
 *   4. Page numbers are honestly reported: null when
 *      `pageCount` is unknown, evenly distributed otherwise.
 *   5. Content hashes are deterministic — two runs on the same
 *      input produce the same hashes, so re-indexing is safe.
 *   6. The overlap is non-empty when there is more than one
 *      chunk (we never lose the boundary context).
 */

import { describe, it, expect } from 'vitest';
import {
  chunkDocument,
  estimateTokens,
  TARGET_CHUNK_TOKENS,
  MAX_CHUNK_TOKENS,
  type DocumentChunk,
} from '../document-chunker.js';

function longParagraph(words: number): string {
  // "word " repeated. The tokeniser counts whitespace-delimited
  // tokens, so this is a faithful approximation of the budget.
  return Array.from({ length: words }, () => 'word').join(' ');
}

describe('estimateTokens', () => {
  it('counts whitespace-delimited tokens', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(2);
    expect(estimateTokens('  leading  and trailing  ')).toBe(3);
  });
});

describe('chunkDocument — purity', () => {
  it('returns the same chunks for the same input', () => {
    const text = longParagraph(2000);
    const a = chunkDocument({ text, pageCount: 10 });
    const b = chunkDocument({ text, pageCount: 10 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].content).toBe(b[i].content);
      expect(a[i].contentHash).toBe(b[i].contentHash);
      expect(a[i].index).toBe(b[i].index);
    }
  });

  it('returns no chunks for an empty document', () => {
    expect(chunkDocument({ text: '', pageCount: 5 })).toEqual([]);
    expect(chunkDocument({ text: '   \n\n  ', pageCount: 5 })).toEqual([]);
  });
});

describe('chunkDocument — token budget', () => {
  it('keeps each chunk under the hard cap', () => {
    const text = Array.from({ length: 50 }, () => longParagraph(100)).join('\n\n');
    const chunks = chunkDocument({ text, pageCount: 50 });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      // Allow a small slack for the overlap tail.
      expect(c.tokenEstimate).toBeLessThanOrEqual(MAX_CHUNK_TOKENS + 100);
    }
  });

  it('groups paragraphs near the target size', () => {
    // 10 paragraphs of ~120 tokens each. With overlap, the chunks
    // should sit a little above the paragraph size.
    const para = longParagraph(120);
    const text = Array.from({ length: 10 }, () => para).join('\n\n');
    const chunks = chunkDocument({ text, pageCount: 1 });
    expect(chunks.length).toBeLessThan(10);
    expect(chunks[0].tokenEstimate).toBeGreaterThan(200);
  });

  it('force-splits a single paragraph that exceeds the cap', () => {
    // One giant paragraph; the chunker must fall back to
    // sentence-boundary splitting.
    const text = longParagraph(3000);
    const chunks = chunkDocument({ text, pageCount: null });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeLessThanOrEqual(MAX_CHUNK_TOKENS + 50);
    }
  });
});

describe('chunkDocument — overlap', () => {
  it('produces non-empty overlap between consecutive chunks', () => {
    const text = Array.from({ length: 20 }, () => longParagraph(100)).join('\n\n');
    const chunks = chunkDocument({ text, pageCount: null });
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of chunk[i] should appear in the head of chunk[i+1].
    // We assert by checking that the i-th chunk's last 12% of tokens
    // are present in the (i+1)-th chunk.
    for (let i = 0; i < chunks.length - 1; i++) {
      const a = chunks[i];
      const b = chunks[i + 1];
      const aWords = a.content.split(/\s+/);
      const overlapWordCount = Math.max(10, Math.floor(aWords.length * 0.12));
      const aTail = aWords.slice(-overlapWordCount).join(' ');
      expect(b.content).toContain(aTail);
    }
  });
});

describe('chunkDocument — page annotations', () => {
  it('distributes chunks evenly across known page count', () => {
    const text = Array.from({ length: 30 }, () => longParagraph(100)).join('\n\n');
    const chunks = chunkDocument({ text, pageCount: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk must have a page range, and the union must
    // cover the reported page count.
    for (const c of chunks) {
      expect(c.pageStart).not.toBeNull();
      expect(c.pageEnd).not.toBeNull();
    }
    const firstStart = chunks[0].pageStart!;
    const lastEnd = chunks[chunks.length - 1].pageEnd!;
    expect(firstStart).toBe(1);
    expect(lastEnd).toBe(20);
  });

  it('returns null page fields when pageCount is null', () => {
    const text = Array.from({ length: 5 }, () => longParagraph(100)).join('\n\n');
    const chunks = chunkDocument({ text, pageCount: null });
    for (const c of chunks) {
      expect(c.pageStart).toBeNull();
      expect(c.pageEnd).toBeNull();
    }
  });
});

describe('chunkDocument — Milestone 4 §35 long-PDF scenario', () => {
  it('finds a unique phrase on a late page of a synthetic long document', () => {
    // Build a fake 80-page document where the unique phrase
    // appears in the last 10% of the text. The 8 000-character
    // truncation would have missed it; chunking must not.
    const phrase = 'barrier function reward shaping on page 80 of this test';
    const filler = longParagraph(200);
    const parts: string[] = [];
    for (let i = 0; i < 80; i++) {
      parts.push(`Page ${i + 1}\n\n${filler}`);
    }
    // Put the phrase on the last page so a single 8 000-char
    // window cannot contain it.
    parts[79] = `Page 80\n\n${filler}\n\n${phrase}\n\n${filler}`;
    const text = parts.join('\n\n');

    const chunks = chunkDocument({ text, pageCount: 80 });
    expect(chunks.length).toBeGreaterThan(5);

    // At least one chunk must contain the phrase verbatim.
    const found = chunks.find((c) => c.content.includes(phrase));
    expect(found).toBeDefined();
    if (found) {
      // The phrase lives on "page 80" of the document. Our
      // page-distribution estimator should land the chunk
      // somewhere in the last 25% of the page range.
      expect(found.pageStart).not.toBeNull();
      if (found.pageStart !== null && found.pageEnd !== null) {
        expect(found.pageEnd).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

describe('chunkDocument — content hashes', () => {
  it('produces SHA-256 hex digests', () => {
    const text = longParagraph(800);
    const chunks = chunkDocument({ text, pageCount: null });
    for (const c of chunks) {
      expect(c.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('changes the hash when the content changes', () => {
    const a = chunkDocument({ text: longParagraph(500), pageCount: null });
    const b = chunkDocument({ text: longParagraph(500) + ' extra', pageCount: null });
    expect(a[0].contentHash).not.toBe(b[0].contentHash);
  });
});
