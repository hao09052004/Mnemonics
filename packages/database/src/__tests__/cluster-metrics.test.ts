/**
 * M6 — computeClusterMetrics unit tests.
 *
 * Pure unit tests. The module is tested in isolation; the
 * integration with the v2 algorithm is in
 * `cluster-benchmark.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { computeClusterMetrics, type Component } from '../cluster-metrics.js';

function comp(id: string, members: string[]): Component {
  return { id, members };
}

describe('computeClusterMetrics — M6 pure unit', () => {
  it('returns zeros for an empty input', () => {
    const m = computeClusterMetrics([], []);
    expect(m.componentCount).toBe(0);
    expect(m.unclusteredFraction).toBe(0);
    expect(m.meanIntraClusterCosine).toBe(0);
  });

  it('counts every non-empty component, even singletons', () => {
    const components = [comp('a', ['x']), comp('b', ['y', 'z'])];
    const m = computeClusterMetrics(components, []);
    expect(m.componentCount).toBe(2);
  });

  it('reports the fraction of nodes that are in singleton components', () => {
    // 2 singletons + 1 doubleton = 4 nodes. Singletons / total
    // = 2/4 = 0.5.
    const components = [
      comp('a', ['x']),
      comp('b', ['y']),
      comp('c', ['u', 'v'])
    ];
    const m = computeClusterMetrics(components, []);
    expect(m.unclusteredFraction).toBeCloseTo(0.5, 5);
  });

  it('returns 0 mean cosine when no edges are provided', () => {
    const components = [comp('a', ['x', 'y', 'z'])];
    const m = computeClusterMetrics(components, []);
    expect(m.meanIntraClusterCosine).toBe(0);
  });

  it('averages the per-component mean edge weight across non-trivial components', () => {
    // Component A: x-y at 0.9, x-z at 0.8, y-z at 0.7. Mean
    // = (0.9 + 0.8 + 0.7) / 3 = 0.8.
    // Component B: u-v at 0.6, u-w at 0.6. Mean = 0.6.
    // Across two components: (0.8 + 0.6) / 2 = 0.7.
    const components = [
      comp('a', ['x', 'y', 'z']),
      comp('b', ['u', 'v', 'w'])
    ];
    const edges = [
      { from: 'x', to: 'y', weight: 0.9 },
      { from: 'x', to: 'z', weight: 0.8 },
      { from: 'y', to: 'z', weight: 0.7 },
      { from: 'u', to: 'v', weight: 0.6 },
      { from: 'u', to: 'w', weight: 0.6 }
    ];
    const m = computeClusterMetrics(components, edges);
    expect(m.meanIntraClusterCosine).toBeCloseTo(0.7, 5);
  });

  it('ignores edges between different components when averaging', () => {
    // Edge x -> u is cross-component and must be ignored.
    const components = [
      comp('a', ['x', 'y']),
      comp('b', ['u', 'v'])
    ];
    const edges = [
      { from: 'x', to: 'y', weight: 0.9 },
      { from: 'u', to: 'v', weight: 0.5 },
      { from: 'x', to: 'u', weight: 0.99 } // cross-component
    ];
    const m = computeClusterMetrics(components, edges);
    // Component A: 0.9. Component B: 0.5. Mean = 0.7.
    expect(m.meanIntraClusterCosine).toBeCloseTo(0.7, 5);
  });
});
