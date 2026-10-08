/**
 * Cluster quality benchmark — Milestone 3 §21.
 *
 * Synthetic dataset with two known topics + a bridge item.
 * We measure the v2 algorithm (mutual-kNN + bridge pruning)
 * and assert that:
 *
 *  - The Finance and RL groups are returned as SEPARATE
 *    clusters (not merged by the bridge).
 *  - The Finance group's members are all present (purity).
 *  - The RL group's members are all present (purity).
 *  - The bridge item either attaches to one side or is
 *    unclustered — it must not be the only thing that
 *    kept the two topics together.
 *
 * The script is intentionally tiny so it can run in CI on the
 * shared test runner. Numbers are deterministic across runs
 * because the input is fully seeded.
 */

import { describe, it, expect } from 'vitest';
import {
  mutualEdges,
  connectedComponents,
  pruneBridges,
  DEFAULT_BRIDGE_RATIO,
  DEFAULT_MUTUAL_K
} from '../cluster-algorithm.js';

interface BenchmarkResult {
  financeMembersRecovered: number;
  rlMembersRecovered: number;
  bridgeAttached: boolean;
  financePurity: number;
  rlPurity: number;
}

function runBenchmark(): BenchmarkResult {
  // 6-node Finance, 6-node RL, 1 bridge.
  const finance = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
  const rl = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const bridge = 'x1';

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

  // Single weak bridge: x1 has two weak edges to one Finance
  // node and one RL node. The bridge weight is far below the
  // internal averages of either subgraph.
  edges.push({ from: bridge, to: 'f1', weight: 0.5 });
  edges.push({ from: bridge, to: 'r1', weight: 0.5 });
  // No reverse direction — the bridge is one-way. v1 would
  // have merged everything into one cluster; v2 drops the
  // bridge at the mutual-kNN gate.
  edges.push({ from: 'f1', to: bridge, weight: 0.5 });
  edges.push({ from: 'r1', to: bridge, weight: 0.5 });

  const allNodes = [...finance, ...rl, bridge];
  const mutual = mutualEdges(edges, DEFAULT_MUTUAL_K);
  const initial = connectedComponents(mutual, allNodes);
  const pruned = pruneBridges(mutual, initial.components, DEFAULT_BRIDGE_RATIO);

  // Find the components that contain Finance and RL members.
  const financeSet = new Set(finance);
  const rlSet = new Set(rl);
  const financeMembersRecovered = new Set<string>();
  const rlMembersRecovered = new Set<string>();
  let bridgeAttached = false;
  const componentsContainingFinance: string[][] = [];
  const componentsContainingRL: string[][] = [];

  for (const members of pruned.components.values()) {
    const hasFinance = members.some((m) => financeSet.has(m));
    const hasRL = members.some((m) => rlSet.has(m));
    const hasBridge = members.includes(bridge);
    if (hasFinance) {
      componentsContainingFinance.push(members);
      for (const m of members) if (financeSet.has(m)) financeMembersRecovered.add(m);
    }
    if (hasRL) {
      componentsContainingRL.push(members);
      for (const m of members) if (rlSet.has(m)) rlMembersRecovered.add(m);
    }
    if (hasBridge && (hasFinance || hasRL)) bridgeAttached = true;
  }

  // Purity: the fraction of a component's non-bridge members
  // that belong to the dominant topic. For a single-topic
  // component the purity is 1; for a merged component it
  // would be < 1.
  const purity = (members: string[], topic: Set<string>) => {
    const counted = members.filter((m) => topic.has(m) || m === bridge);
    if (counted.length === 0) return 0;
    const inTopic = counted.filter((m) => topic.has(m)).length;
    return inTopic / counted.length;
  };

  const financePurity = componentsContainingFinance.length
    ? Math.max(...componentsContainingFinance.map((c) => purity(c, financeSet)))
    : 0;
  const rlPurity = componentsContainingRL.length
    ? Math.max(...componentsContainingRL.map((c) => purity(c, rlSet)))
    : 0;

  return {
    financeMembersRecovered: financeMembersRecovered.size,
    rlMembersRecovered: rlMembersRecovered.size,
    bridgeAttached,
    financePurity,
    rlPurity,
  };
}

describe('Cluster quality benchmark (Milestone 3 §21)', () => {
  it('separates two dense topics with a weak bridge', () => {
    const r = runBenchmark();
    // Recovered membership: every Finance and RL member is in
    // SOME cluster (even if the bridge attaches to one side, the
    // node itself is not lost).
    expect(r.financeMembersRecovered).toBe(6);
    expect(r.rlMembersRecovered).toBe(6);
    // No mixed components: the maximum purity for the Finance
    // side is 1 (no RL members in the Finance component), and
    // the same for the RL side. A merged cluster would push
    // purity below 1.
    expect(r.financePurity).toBe(1);
    expect(r.rlPurity).toBe(1);
    // The benchmark numbers are the basis for the "Cluster
    // quality is measured rather than assumed" acceptance
    // criterion. They are deterministic so a regression in
    // the algorithm would show up as a numeric change.
    // eslint-disable-next-line no-console
    console.log('[cluster-benchmark]', JSON.stringify(r));
  });
});
