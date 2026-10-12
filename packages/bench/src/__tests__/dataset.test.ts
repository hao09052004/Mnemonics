import { describe, it, expect } from 'vitest';
import { loadDataset } from '../dataset.js';

describe('relevance-benchmark dataset', () => {
  it('contains 60 memories', () => {
    const dataset = loadDataset();
    expect(dataset.memories).toHaveLength(60);
  });

  it('contains 30 queries with non-empty relevant_ids', () => {
    const dataset = loadDataset();
    expect(dataset.queries).toHaveLength(30);
    for (const q of dataset.queries) {
      expect(q.relevant_ids.length).toBeGreaterThan(0);
    }
  });

  it('contains 10 products with detected_type=product', () => {
    const dataset = loadDataset();
    const products = dataset.memories.filter(
      (m) => m.classification.detected_type === 'product'
    );
    expect(products).toHaveLength(10);
  });

  it('every query has at least one of the four labels', () => {
    const dataset = loadDataset();
    const validLabels = new Set(['lexical','semantic','structured','hybrid']);
    for (const q of dataset.queries) {
      expect(q.labels.some((l) => validLabels.has(l))).toBe(true);
    }
  });
});
