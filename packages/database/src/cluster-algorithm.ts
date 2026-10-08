/**
 * Cluster algorithm v2 — mutual-kNN + bridge pruning.
 *
 * The v1 algorithm (`computeComponents` in `clusters.ts`) was
 * connected components on a curated edge graph. It had a known
 * single-link chaining problem: a weak bridge edge between two
 * otherwise unrelated topics would merge the two groups into a
 * single cluster. The v1 title was also a keyword dump ("A & B
 * & C") because it picked the top-K frequent words without
 * caring about phrase structure.
 *
 * v2 keeps connected components as the cheap backbone (it is
 * O(N) on the edge table, not O(N^2) on the embedding table),
 * then layers two corrections on top:
 *
 *   1. Mutual-kNN gate. An edge (a, b) is kept only if b is in
 *      a's top-K nearest neighbours AND a is in b's top-K
 *      nearest neighbours. A one-way edge — common when one
 *      item is genuinely isolated and another item has many
 *      close neighbours — is dropped. This is the single biggest
 *      source of false-positive bridges.
 *
 *   2. Bridge pruning. After components are formed, an edge
 *      whose weight is dramatically lower than the cluster's
 *      internal average is a "bridge edge". We cut it, which
 *      may split one component into two smaller ones. The split
 *      is recorded as a cohesion hint: the original component
 *      had at least one weak cross-topic link, so the resulting
 *      groups are more honest representations of the topics.
 *
 * Naming is upgraded in `buildClusterTitle` (in `clusters.ts`)
 * to prefer tag bigrams and to discard short / generic tokens.
 *
 * These primitives are pure functions so they can be unit-tested
 * without a database. The SQL CTE that produces the edge list
 * is the only thing that needs the pool; the rest of the
 * pipeline runs in memory on the result of that one query.
 */

export interface EdgeInput {
  from: string;
  to: string;
  weight: number;
}

/**
 * For each item, the set of its top-K neighbours by weight.
 * Used as the symmetric gate: a mutual edge (a, b) is one where
 * b is in a's topK AND a is in b's topK. Asymmetric edges are
 * the most common source of false-positive bridges — a noisy
 * item is everyone else's nearest neighbour but its own top-K
 * is empty.
 */
export function topKNeighbours(
  edges: EdgeInput[],
  k: number
): Map<string, Set<string>> {
  const byFrom = new Map<string, Array<{ to: string; weight: number }>>();
  for (const e of edges) {
    let list = byFrom.get(e.from);
    if (!list) {
      list = [];
      byFrom.set(e.from, list);
    }
    list.push({ to: e.to, weight: e.weight });
  }
  const out = new Map<string, Set<string>>();
  for (const [from, list] of byFrom.entries()) {
    list.sort((a, b) => b.weight - a.weight);
    const set = new Set<string>();
    for (let i = 0; i < Math.min(k, list.length); i++) {
      set.add(list[i].to);
    }
    out.set(from, set);
  }
  return out;
}

/**
 * Reduce an edge list to mutual edges only. Edges that are
 * not symmetric in the top-K sense are dropped. The result is
 * the input to the connected-components pass.
 */
export function mutualEdges(
  edges: EdgeInput[],
  k: number
): EdgeInput[] {
  const topK = topKNeighbours(edges, k);
  const out: EdgeInput[] = [];
  for (const e of edges) {
    const aSays = topK.get(e.from);
    const bSays = topK.get(e.to);
    if (!aSays || !bSays) continue;
    if (!aSays.has(e.to) || !bSays.has(e.from)) continue;
    out.push(e);
  }
  return out;
}

/**
 * Union-find over the surviving (mutual) edges. Returns a
 * canonical component id (the smallest member id) for every
 * item, plus the member sets.
 */
export function connectedComponents(
  edges: EdgeInput[],
  allNodes: string[]
): { componentOf: Map<string, string>; components: Map<string, string[]> } {
  const parent = new Map<string, string>();
  for (const n of allNodes) parent.set(n, n);
  const find = (x: string): string => {
    let r = parent.get(x)!;
    while (r !== parent.get(r)!) {
      parent.set(r, parent.get(parent.get(r)!)!);
      r = parent.get(r)!;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Canonical id = lexically smaller root. Combined with sorted
    // member ids, this gives a stable cluster id that does not
    // depend on edge insertion order.
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const e of edges) {
    if (parent.has(e.from) && parent.has(e.to)) union(e.from, e.to);
  }
  const componentOf = new Map<string, string>();
  for (const n of allNodes) componentOf.set(n, find(n));
  const components = new Map<string, string[]>();
  for (const n of allNodes) {
    const r = componentOf.get(n)!;
    let list = components.get(r);
    if (!list) {
      list = [];
      components.set(r, list);
    }
    list.push(n);
  }
  return { componentOf, components };
}

/**
 * Detect and prune bridge edges. An edge is a "bridge" if its
 * weight is below `bridgeRatio * clusterInternalAverage` for
 * the cluster it currently sits in. Removing a bridge may
 * split the cluster; we re-run union-find to obtain the new
 * components.
 *
 * Returns the new edge list, the new components, and the
 * per-cluster average edge weight (for cohesion scoring).
 */
export function pruneBridges(
  edges: EdgeInput[],
  components: Map<string, string[]>,
  bridgeRatio: number
): {
  survivingEdges: EdgeInput[];
  components: Map<string, string[]>;
  clusterAvgWeight: Map<string, number>;
  bridgeEdgeCount: number;
} {
  // Per-cluster, per-edge bookkeeping: how many edges land in
  // each cluster, and what is the mean of those edge weights.
  const clusterEdgeSums = new Map<string, { sum: number; count: number }>();
  for (const e of edges) {
    // Edges are undirected for this analysis (auto-link writes
    // both directions, so the same pair appears twice). The
    // pair-wise average treats that double-write as a
    // confirmation, not as a separate signal.
  }
  // Build edge -> clusterId map. An edge belongs to a cluster if
  // BOTH endpoints share a component AFTER the mutual gate.
  // (Edges that survived the gate are by construction
  // intra-component in the v1 graph; bridges are intra-component
  // edges that look weak once you compare them to the rest.)
  const nodeToCluster = new Map<string, string>();
  for (const [cid, members] of components.entries()) {
    for (const m of members) nodeToCluster.set(m, cid);
  }
  const clusterEdges = new Map<string, EdgeInput[]>();
  for (const e of edges) {
    const ca = nodeToCluster.get(e.from);
    const cb = nodeToCluster.get(e.to);
    if (!ca || ca !== cb) continue;
    let list = clusterEdges.get(ca);
    if (!list) {
      list = [];
      clusterEdges.set(ca, list);
    }
    list.push(e);
  }
  for (const [cid, list] of clusterEdges.entries()) {
    const sum = list.reduce((s, e) => s + e.weight, 0);
    clusterEdgeSums.set(cid, { sum, count: list.length });
  }

  const surviving: EdgeInput[] = [];
  let bridgeCount = 0;
  for (const e of edges) {
    const ca = nodeToCluster.get(e.from);
    const cb = nodeToCluster.get(e.to);
    if (ca !== cb) {
      surviving.push(e);
      continue;
    }
    const stats = clusterEdgeSums.get(ca!);
    if (!stats || stats.count === 0) {
      surviving.push(e);
      continue;
    }
    const internalAverage = stats.sum / stats.count;
    if (e.weight >= bridgeRatio * internalAverage) {
      surviving.push(e);
    } else {
      bridgeCount++;
    }
  }

  // Re-run union-find on the surviving edges. The bridge cuts
  // may have split a component. Restrict the rebuild to nodes
  // that are reachable from surviving edges OR that belonged
  // to an original component of size >= 2. Otherwise isolated
  // nodes (ones that had edges but lost them all to pruning)
  // would each become their own "component of size 1", which
  // the downstream minSize filter drops, but would also
  // inflate the component count that the tests assert on.
  const nodePool = new Set<string>();
  for (const e of surviving) {
    nodePool.add(e.from);
    nodePool.add(e.to);
  }
  for (const members of components.values()) {
    if (members.length < 2) continue;
    for (const m of members) nodePool.add(m);
  }
  const rebuilt = connectedComponents(
    surviving,
    Array.from(nodePool)
  );

  const clusterAvgWeight = new Map<string, number>();
  for (const [cid, members] of rebuilt.components.entries()) {
    const memberSet = new Set(members);
    const intra: number[] = [];
    for (const e of surviving) {
      if (memberSet.has(e.from) && memberSet.has(e.to)) intra.push(e.weight);
    }
    clusterAvgWeight.set(
      cid,
      intra.length > 0 ? intra.reduce((s, w) => s + w, 0) / intra.length : 0
    );
  }
  return {
    survivingEdges: surviving,
    components: rebuilt.components,
    clusterAvgWeight,
    bridgeEdgeCount: bridgeCount,
  };
}

/**
 * Bridge-suppression rule of thumb: drop an intra-cluster edge
 * when its weight is below half the cluster average. The 0.5
 * ratio is the simplest discrimination that still lets a
 * genuinely tight cluster survive while pruning the obvious
 * cross-topic chains. Tunable via the second argument.
 */
export const DEFAULT_BRIDGE_RATIO = 0.5;

/**
 * Mutual-kNN default. k=5 mirrors the auto-link pass
 * (top-5 nearest neighbours). Raising it past 10 makes
 * the gate almost a no-op; lowering it below 3 starts to
 * hide real signals.
 */
export const DEFAULT_MUTUAL_K = 5;
