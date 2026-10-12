/**
 * parseQuery — deterministic natural-language query parser.
 *
 * The parser is the user-facing entry point for the M3 search
 * feature: a Vietnamese or English type hint (e.g. "công thức
 * phở bò", "bài viết về bảo mật") becomes a structured
 * `detectedType` filter so the dashboard can render the matching
 * chip before the user finishes typing.
 *
 * These tests pin the contract:
 *  - Vietnamese and English type hints both lift into `structured`.
 *  - Unrecognised words stay in `residualQ` so the lexical /
 *    semantic legs still get the meaningful words.
 *  - Relative date hints become ISO `captured_after` /
 *    `captured_before`.
 *  - The function is pure and synchronous; `now` is injectable
 *    so the date tests are deterministic.
 */
import { describe, expect, it } from 'vitest';
import { parseQuery, DETECTED_TYPES } from '../query-parser.js';

describe('parseQuery', () => {
  it('1: lifts a Vietnamese type hint into structured.detectedType', () => {
    const out = parseQuery('công thức phở bò');
    expect(out.structured?.detectedType?.[0]).toBe('recipe');
    expect(out.residualQ).toBe('phở bò');
  });

  it('2: lifts a Vietnamese article hint', () => {
    const out = parseQuery('bài viết về bảo mật');
    expect(out.structured?.detectedType?.[0]).toBe('article');
    expect(out.residualQ).toBe('về bảo mật');
  });

  it('3: lifts English type hints and leaves the rest as residualQ', () => {
    const out = parseQuery('spicy ramen recipe from Japan');
    expect(out.structured?.detectedType).toContain('recipe');
    expect(out.residualQ).toBe('spicy ramen from Japan');
  });

  it('4: pins that "note" is lifted as a type hint (intentional vocabulary)', () => {
    const out = parseQuery('a quick note about something');
    // "note" is a DETECTED_TYPE — a short user note is
    // indistinguishable from a captured text note, so the
    // chip should fire. Future vocabulary changes must
    // update this test, not the parser.
    expect(out.structured?.detectedType).toContain('note');
    expect(out.residualQ).toBe('a quick about something');
  });

  it('5: resolves "yesterday" to a one-day captured_after/captured_before window', () => {
    const now = new Date('2026-10-12T09:00:00.000Z');
    const out = parseQuery('recipes I saved yesterday', now);
    expect(out.captured_after).toBe('2026-10-11T00:00:00.000Z');
    expect(out.captured_before).toBe('2026-10-11T23:59:59.999Z');
    expect(out.structured?.detectedType).toContain('recipe');
  });

  it('6: resolves "today" to a same-day window', () => {
    const now = new Date('2026-10-12T09:00:00.000Z');
    const out = parseQuery('memories today', now);
    expect(out.captured_after).toBe('2026-10-12T00:00:00.000Z');
    expect(out.captured_before).toBe('2026-10-12T23:59:59.999Z');
  });

  it('7: "last week" sets captured_after only (no upper bound)', () => {
    const now = new Date('2026-10-12T09:00:00.000Z');
    const out = parseQuery('products from last week', now);
    expect(out.captured_after).toBe('2026-10-05T00:00:00.000Z');
    expect(out.captured_before).toBeUndefined();
  });

  it('8: an empty / non-matching input still returns a valid object', () => {
    const out = parseQuery('hello world');
    expect(out.structured).toBeUndefined();
    expect(out.residualQ).toBe('hello world');
  });

  it('9: DETECTED_TYPES is a closed, ordered set of 11 values', () => {
    expect(DETECTED_TYPES).toEqual([
      'article', 'product', 'recipe', 'video', 'quote', 'highlight',
      'webpage', 'image', 'note', 'document', 'other'
    ]);
  });
});
