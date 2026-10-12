/**
 * M6 — cluster quality metrics.
 *
 * Pure functions that, given a list of components and a list
 * of edges, return three numbers that summarise the
 * clustering:
 *
 *   - componentCount: the number of components, including
 *     singletons. A higher number means a more fragmented
 *     clustering.
 *   - unclusteredFraction: the fraction of nodes that are
 *     in singleton components. A higher number means more
 *     "noise" — items the algorithm could not attach to any
 *     group.
 *   - meanIntraClusterCosine: the mean of the per-component
 *     mean edge weight, averaged across non-singleton
 *     components. A higher number means the components are
 *     internally coherent.
 *
 * The functions are pure and deterministic. No DB, no
 * randomness, no wall-clock. The benchmark in
 * `__tests__/cluster-benchmark.test.ts` uses these
 * primitives to gate the build.
 */

export interface Component {
  /** Stable id, e.g. the FNV-1a hash of the sorted member list. */
  id: string;
  /** Member node ids. */
  members: string[];
}

export interface ClusterEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ClusterMetrics {
  componentCount: number;
  unclusteredFraction: number;
  meanIntraClusterCosine: number;
}

export function computeClusterMetrics(
  components: Component[],
  edges: ClusterEdge[]
): ClusterMetrics {
  const componentCount = components.length;

  let totalNodes = 0;
  let singletonNodes = 0;
  for (const c of components) {
    totalNodes += c.members.length;
    if (c.members.length === 1) singletonNodes += 1;
  }
  const unclusteredFraction = totalNodes === 0 ? 0 : singletonNodes / totalNodes;

  // Build a node -> component index so we can tell whether an
  // edge is intra-component. Edges that span components are
  // bridges and are excluded from the mean.
  const nodeToComponent = new Map<string, string>();
  for (const c of components) {
    for (const m of c.members) {
      nodeToComponent.set(m, c.id);
    }
  }

  const perComponent = new Map<string, number[]>();
  for (const e of edges) {
    const a = nodeToComponent.get(e.from);
    const b = nodeToComponent.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (a !== b) continue;
    let list = perComponent.get(a);
    if (!list) {
      list = [];
      perComponent.set(a, list);
    }
    list.push(e.weight);
  }

  let meanIntraClusterCosine = 0;
  let nonTrivial = 0;
  for (const [id, weights] of perComponent.entries()) {
    const c = components.find((x) => x.id === id);
    if (!c || c.members.length < 2) continue;
    const sum = weights.reduce((s, w) => s + w, 0);
    meanIntraClusterCosine += sum / weights.length;
    nonTrivial += 1;
  }
  if (nonTrivial > 0) {
    meanIntraClusterCosine = meanIntraClusterCosine / nonTrivial;
  }

  return { componentCount, unclusteredFraction, meanIntraClusterCosine };
}
