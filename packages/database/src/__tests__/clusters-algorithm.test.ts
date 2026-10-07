/**
 * Cluster algorithm — pure unit tests.
 *
 * The connected-components SQL is exercised by the integration spec
 * (`clusters.test.ts`). This file covers the deterministic, DB-free
 * pieces: id hashing, representative selection, signal collection,
 * and title generation.
 */

import { describe, it, expect } from 'vitest';
import {
  clusterIdForMembers,
  pickRepresentative,
  collectSignals,
  buildClusterTitle,
  DEFAULT_CLUSTER_CONFIG
} from '@mnemonics/database';

describe('clusterIdForMembers', () => {
  it('is order-independent', () => {
    const a = clusterIdForMembers(['x', 'y', 'z']);
    const b = clusterIdForMembers(['z', 'x', 'y']);
    expect(a).toEqual(b);
  });

  it('differs when membership differs', () => {
    expect(clusterIdForMembers(['a', 'b'])).not.toEqual(
      clusterIdForMembers(['a', 'c'])
    );
  });

  it('returns a 16-char hex string', () => {
    const id = clusterIdForMembers(['one']);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('throws on empty input', () => {
    expect(() => clusterIdForMembers([])).toThrow();
  });
});

describe('pickRepresentative', () => {
  it('picks the highest-average-similarity member', () => {
    const rep = pickRepresentative([
      { itemId: 'a', averageSimilarity: 0.5 },
      { itemId: 'b', averageSimilarity: 0.9 },
      { itemId: 'c', averageSimilarity: 0.7 }
    ]);
    expect(rep).toEqual('b');
  });

  it('breaks ties deterministically by id', () => {
    const rep = pickRepresentative([
      { itemId: 'b', averageSimilarity: 0.5 },
      { itemId: 'a', averageSimilarity: 0.5 }
    ]);
    expect(rep).toEqual('a');
  });

  it('throws on empty', () => {
    expect(() => pickRepresentative([])).toThrow();
  });
});

describe('collectSignals', () => {
  it('aggregates tags and tokens', () => {
    const signals = collectSignals([
      { title: 'DCF valuation', tldr: 'Discounted cash flow model', tags: ['valuation', 'dcf'] },
      { title: 'Comparable companies', tldr: 'Trading multiples', tags: ['valuation', 'comps'] }
    ]);
    expect(signals.tagCounts.get('valuation')).toBe(4);
    expect(signals.tagCounts.get('dcf')).toBe(2);
    expect(signals.tokenCounts.get('valuation')).toBeGreaterThan(0);
  });

  it('strips stopwords and diacritics', () => {
    const signals = collectSignals([
      { title: 'Học tiếng Anh', tldr: 'từ vựng mới', tags: ['language', 'the'] }
    ]);
    // 'the' is a stopword even as a tag
    expect(signals.tagCounts.has('the')).toBe(false);
    // Vietnamese diacritics are folded for matching
    expect(signals.tokenCounts.has('hoc')).toBe(true);
  });
});

describe('buildClusterTitle', () => {
  it('returns a meaningful 2..4 word title for valuation members', () => {
    const signals = collectSignals([
      { title: 'DCF valuation', tldr: 'Cash flow', tags: ['valuation', 'dcf'] },
      { title: 'Comparable companies', tldr: 'Trading multiples', tags: ['valuation', 'comps'] },
      { title: 'EV/EBITDA', tldr: 'Enterprise multiple', tags: ['valuation', 'ev-ebitda'] }
    ]);
    const title = buildClusterTitle(signals, 3);
    expect(title).not.toBeNull();
    expect(title!.toLowerCase()).toContain('valuation');
  });

  it('returns null when signals are too generic', () => {
    const signals = collectSignals([
      { title: 'A', tldr: 'B', tags: [] },
      { title: 'C', tldr: 'D', tags: [] }
    ]);
    expect(buildClusterTitle(signals, 2)).toBeNull();
  });

  it('rejects a single-member cluster', () => {
    const signals = collectSignals([{ title: 'Solo', tldr: 'lonely', tags: [] }]);
    expect(buildClusterTitle(signals, 1)).toBeNull();
  });
});

describe('DEFAULT_CLUSTER_CONFIG', () => {
  it('uses 0.78 cosine threshold to match the auto-link pass', () => {
    expect(DEFAULT_CLUSTER_CONFIG.similarityThreshold).toBeCloseTo(0.78, 5);
  });

  it('requires at least 3 members', () => {
    expect(DEFAULT_CLUSTER_CONFIG.minSize).toBe(3);
  });
});
