/**
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
  });
});
