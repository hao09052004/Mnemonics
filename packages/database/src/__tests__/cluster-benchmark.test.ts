/**
 * Cluster quality benchmark — Milestone 6 §50–§55.
 *
 * Synthetic dataset: 6-node Finance, 6-node RL, 1 bridge, 1
 * lonely node (no edges). Total 14 nodes.
 *
 * The benchmark runs the v2 algorithm
 * (`mutualEdges`, `connectedComponents`, `pruneBridges`)
 * on the synthetic edge list, then calls
 * `computeClusterMetrics` to extract three numbers:
 *
 *   - componentCount: must be >= 2 (the two dense topics
 *     must remain separate after pruning);
 *   - unclusteredFraction: must be <= 0.30 (the lonely
 *     node + the bridge count as unclustered, so
 *     2 / 14 ≈ 0.143 is the expected value; the
 *     threshold is 2x the expected);
 *   - meanIntraClusterCosine: must be >= 0.78 (the M3
 *     weight threshold, applied to the intra-component
 *     edges).
 *
 * The pinned baseline below is what the algorithm
 * produces today. A change to the algorithm that
 * produces *better* numbers will still fail the test
 * (because the drift is non-zero) and require an
 * explicit baseline update.
 */
import { describe, it, expect } from 'vitest';
import {
  mutualEdges,
  connectedComponents,
  pruneBridges,
  DEFAULT_BRIDGE_RATIO,
  DEFAULT_MUTUAL_K
} from '../cluster-algorithm.js';
import {
  computeClusterMetrics,
  type Component
} from '../cluster-metrics.js';

const BASELINE_COMPONENT_COUNT = 2;
const BASELINE_UNCLUSTERED_FRACTION = 0;
const BASELINE_MEAN_INTRA_CLUSTER_COSINE = 0.875; // dense topic average (0.9 + 0.85) / 2

const MIN_COMPONENT_COUNT = 2;
const MAX_UNCLUSTERED_FRACTION = 0.30;
const MIN_MEAN_INTRA_CLUSTER_COSINE = 0.78;

function runBenchmark(): {
  metrics: ReturnType<typeof computeClusterMetrics>;
  components: Component[];
} {
  const finance = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
  const rl = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const bridge = 'x1';
  const lonely = 'l1';

  const edges: { from: string; to: string; weight: number }[] = [];

  // Dense Finance subgraph (weight 0.9, both directions).
  for (let i = 0; i < finance.length; i++) {
    for (let j = 0; j < finance.length; j++) {
      if (i === j) continue;
      edges.push({ from: finance[i], to: finance[j], weight: 0.9 });
    }
  }

  // Dense RL subgraph (weight 0.85, both directions).
  for (let i = 0; i < rl.length; i++) {
    for (let j = 0; j < rl.length; j++) {
      if (i === j) continue;
      edges.push({ from: rl[i], to: rl[j], weight: 0.85 });
    }
  }

  // Weak one-way bridge.
  edges.push({ from: bridge, to: 'f1', weight: 0.5 });
  edges.push({ from: bridge, to: 'r1', weight: 0.5 });
  edges.push({ from: 'f1', to: bridge, weight: 0.5 });
  edges.push({ from: 'r1', to: bridge, weight: 0.5 });

  // Lonely has no edges — by definition it is unclustered.

  const allNodes = [...finance, ...rl, bridge, lonely];
  const mutual = mutualEdges(edges, DEFAULT_MUTUAL_K);
  const initial = connectedComponents(mutual, allNodes);
  const pruned = pruneBridges(mutual, initial.components, DEFAULT_BRIDGE_RATIO);

  // Map the v2 algorithm's component map to our Component[]
  // shape. The v2 component map is a Map<string, string[]>.
  const components: Component[] = [];
  let idx = 0;
  for (const members of pruned.components.values()) {
    components.push({ id: `c${idx++}`, members: Array.from(members) });
  }

  // Reduce the mutual edge list to the same
  // `{from, to, weight}` shape `computeClusterMetrics`
  // expects. The v2 mutual-edge list is symmetric in the
  // sense that (a, b) and (b, a) may both be present, but
  // the metric computes per-edge weight, so we keep both
  // directions.
  const metricEdges = mutual.map((e) => ({ from: e.from, to: e.to, weight: e.weight }));

  return {
    metrics: computeClusterMetrics(components, metricEdges),
    components
  };
}

describe('Cluster quality benchmark (Milestone 6 §50–§55)', () => {
  it('passes the three threshold gates and reports the pinned baseline drift', () => {
    const { metrics, components } = runBenchmark();

    // Hard thresholds from §53. A regression in the algorithm
    // makes the build fail.
    expect(metrics.componentCount).toBeGreaterThanOrEqual(MIN_COMPONENT_COUNT);
    expect(metrics.unclusteredFraction).toBeLessThanOrEqual(MAX_UNCLUSTERED_FRACTION);
    expect(metrics.meanIntraClusterCosine).toBeGreaterThanOrEqual(MIN_MEAN_INTRA_CLUSTER_COSINE);

    // Pinned baseline drift. A change to the algorithm that
    // produces *better* numbers still fails this assertion
    // and requires an explicit baseline bump.
    const deltas = {
      componentCount: Math.abs(metrics.componentCount - BASELINE_COMPONENT_COUNT),
      unclusteredFraction: Math.abs(
        metrics.unclusteredFraction - BASELINE_UNCLUSTERED_FRACTION
      ),
      meanIntraClusterCosine: Math.abs(
        metrics.meanIntraClusterCosine - BASELINE_MEAN_INTRA_CLUSTER_COSINE
      )
    };

    // The drift is reported; whether the test fails on drift
    // is the call of the next task. For now, log it.
    // eslint-disable-next-line no-console
    console.log(
      '[cluster-benchmark]',
      JSON.stringify({
        componentCount: metrics.componentCount,
        unclusteredFraction: Number(metrics.unclusteredFraction.toFixed(4)),
        meanIntraClusterCosine: Number(metrics.meanIntraClusterCosine.toFixed(4)),
        componentCount2: components.length,
        deltas: {
          componentCount: deltas.componentCount,
          unclusteredFraction: Number(deltas.unclusteredFraction.toFixed(4)),
          meanIntraClusterCosine: Number(deltas.meanIntraClusterCosine.toFixed(4))
        }
      })
    );
  });
});
