/**
<<<<<<< HEAD
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
=======
 * Query parser unit tests (spec 0005 §7.3).
 *
 * The parser is a pure function; every phrase it can
 * recognise has a test here.
 */
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';

describe('parseQuery (M3)', () => {
  const NOW = new Date('2026-10-11T10:00:00.000Z');

  it('returns an empty result for an empty input', () => {
    const r = parseQuery('', NOW);
    expect(r.residualQ).toBe('');
    expect(r.structured).toBeUndefined();
    expect(r.captured_after).toBeUndefined();
    expect(r.captured_before).toBeUndefined();
  });

  it('keeps unmatched words in residualQ', () => {
    const r = parseQuery('wooden chairs', NOW);
    expect(r.residualQ).toBe('wooden chairs');
    expect(r.structured).toBeUndefined();
  });

  it('parses "recipes" into detectedType', () => {
    const r = parseQuery('recipes', NOW);
    expect(r.structured?.detectedType).toEqual(['recipe']);
    expect(r.residualQ).toBe('');
  });

  it('parses "this week" into a 7-day window', () => {
    const r = parseQuery('recipes this week', NOW);
    expect(r.structured?.detectedType).toEqual(['recipe']);
    expect(r.captured_after).toBe('2026-10-05T00:00:00.000Z');
    expect(r.captured_before).toBe('2026-10-11T23:59:59.000Z');
  });

  it('parses "last week" into the prior 7-day window', () => {
    const r = parseQuery('last week', NOW);
    expect(r.captured_after).toBe('2026-10-04T00:00:00.000Z');
    expect(r.captured_before).toBe('2026-10-10T23:59:59.999Z');
  });

  it('parses "2 days ago" into a relative window', () => {
    const r = parseQuery('2 days ago', NOW);
    expect(r.captured_after).toBe('2026-10-09T10:00:00.000Z');
    expect(r.captured_before).toBe('2026-10-11T10:00:00.000Z');
  });

  it('parses "after YYYY-MM-DD"', () => {
    const r = parseQuery('after 2026-10-01', NOW);
    expect(r.captured_after).toBe('2026-10-01T00:00:00.000Z');
  });

  it('parses "before YYYY-MM-DD"', () => {
    const r = parseQuery('before 2026-10-15', NOW);
    expect(r.captured_before).toBe('2026-10-15T23:59:59.999Z');
  });

  it('parses structured tokens brand: and material:', () => {
    const r = parseQuery('brand:ikea material:wood', NOW);
    expect(r.structured?.brand).toEqual(['ikea']);
    expect(r.structured?.material).toEqual(['wood']);
    expect(r.residualQ).toBe('');
  });

  it('drops a structured key with contradictory values', () => {
    const r = parseQuery('brand:foo brand:bar', NOW);
    expect(r.structured?.brand).toBeUndefined();
    expect(r.trace.some(t => t.kind === 'structured-contradiction')).toBe(true);
  });

  it('handles "articles" hint', () => {
    const r = parseQuery('articles', NOW);
    expect(r.structured?.detectedType).toEqual(['article']);
  });

  it('handles multiple type hints', () => {
    const r = parseQuery('articles videos', NOW);
    expect(r.structured?.detectedType).toEqual(expect.arrayContaining(['article', 'video']));
  });

  it('strips consumed tokens from residual', () => {
    const r = parseQuery('articles brand:nike', NOW);
    expect(r.structured?.detectedType).toEqual(['article']);
    expect(r.structured?.brand).toEqual(['nike']);
    expect(r.residualQ).toBe('');
  });

  it('combines a date phrase with structured tokens', () => {
    const r = parseQuery('recipes this week brand:nyt', NOW);
    expect(r.structured?.detectedType).toEqual(['recipe']);
    expect(r.structured?.brand).toEqual(['nyt']);
    expect(r.captured_after).toBe('2026-10-05T00:00:00.000Z');
  });

  it('is case-insensitive on type hints', () => {
    const r = parseQuery('RECIPES', NOW);
    expect(r.structured?.detectedType).toEqual(['recipe']);
>>>>>>> 421dc0c (feat(search): M3 smart search & dynamic smart spaces (parser + structured leg))
  });

  // Spec 0005 §20 review focus 4: Vietnamese type hints.
  it('parses the Vietnamese "công thức" phrase as a recipe hint', () => {
    const r = parseQuery('công thức phở bò', NOW);
    expect(r.structured?.detectedType).toEqual(['recipe']);
    // The phrase is consumed; "phở bò" stays in residualQ
    // for the semantic leg.
    expect(r.residualQ).toContain('phở');
  });

  it('parses the Vietnamese "bài viết" phrase as an article hint', () => {
    const r = parseQuery('bài viết về bảo mật', NOW);
    expect(r.structured?.detectedType).toEqual(['article']);
    expect(r.residualQ).toContain('bảo');
  });
});
