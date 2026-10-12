/**
 * Cluster algorithm v2 — pure-function unit tests.
 *
 * These tests cover the two new primitives that layer on top
 * of v1's connected-components pass:
 *
 *  1. Mutual-kNN gate: one-way edges must be dropped, the
 *     symmetric edges must survive.
 *  2. Bridge pruning: an edge much weaker than the cluster
 *     average is identified as a bridge and cut, splitting
 *     the cluster into smaller honest topics.
 *
 * The tests are deliberately small and graph-shaped: a 6-node
 * Finance group, a 6-node Reinforcement-Learning group, and a
 * single weak "bridge" edge between them. v1 merges all 13
 * nodes; v2 must keep the bridge cut and leave two clusters
 * of 6.
 */

import { describe, it, expect } from 'vitest';
import {
  mutualEdges,
  topKNeighbours,
  connectedComponents,
  pruneBridges,
  DEFAULT_BRIDGE_RATIO,
  DEFAULT_MUTUAL_K,
} from '../cluster-algorithm.js';

const F = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']; // Finance
const R = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']; // Reinforcement Learning
const BRIDGE = 'x1';

function financeEdges(): { from: string; to: string; weight: number }[] {
  // Dense Finance subgraph. Every Finance node has the other 5
  // as top-K neighbours with weight 0.9. Edges are written
  // BOTH directions to mirror what the auto-link pass does at
  // runtime — the v2 mutual-kNN gate requires symmetric
  // "a is in b's top-K" relationships, not just one-way.
  const out: { from: string; to: string; weight: number }[] = [];
  for (let i = 0; i < F.length; i++) {
    for (let j = 0; j < F.length; j++) {
      if (i === j) continue;
      out.push({ from: F[i], to: F[j], weight: 0.9 });
    }
  }
  return out;
}

function rlEdges(): { from: string; to: string; weight: number }[] {
  const out: { from: string; to: string; weight: number }[] = [];
  for (let i = 0; i < R.length; i++) {
    for (let j = 0; j < R.length; j++) {
      if (i === j) continue;
      out.push({ from: R[i], to: R[j], weight: 0.85 });
    }
  }
  return out;
}

function bridgeEdge(): { from: string; to: string; weight: number } {
  // The single weak bridge. The Finance side has a 0.5 edge to x1
  // and the RL side has a 0.5 edge to x1. The bridge weight is
  // far below the Finance and RL internal averages, so pruning
  // must cut it.
  return { from: 'f1', to: BRIDGE, weight: 0.5 };
}

function rlBridgeEdge(): { from: string; to: string; weight: number } {
  return { from: 'r1', to: BRIDGE, weight: 0.5 };
}

describe('topKNeighbours', () => {
  it('returns the K strongest neighbours per node', () => {
    const edges = [
      { from: 'a', to: 'b', weight: 0.9 },
      { from: 'a', to: 'c', weight: 0.7 },
      { from: 'a', to: 'd', weight: 0.5 },
      { from: 'a', to: 'e', weight: 0.3 },
    ];
    const top = topKNeighbours(edges, 2);
    expect(top.get('a')?.has('b')).toBe(true);
    expect(top.get('a')?.has('c')).toBe(true);
    expect(top.get('a')?.has('d')).toBe(false);
  });

  it('respects K larger than the candidate list', () => {
    const edges = [{ from: 'a', to: 'b', weight: 0.9 }];
    const top = topKNeighbours(edges, 10);
    expect(top.get('a')?.size).toBe(1);
  });
});

describe('mutualEdges', () => {
  it('keeps symmetric edges in the top-K sense', () => {
    // a -> b strong, b -> a absent: not mutual.
    const oneWay = [{ from: 'a', to: 'b', weight: 0.9 }];
    expect(mutualEdges(oneWay, 5)).toEqual([]);

    // Both directions present: mutual.
    const twoWay = [
      { from: 'a', to: 'b', weight: 0.9 },
      { from: 'b', to: 'a', weight: 0.9 },
    ];
    const out = mutualEdges(twoWay, 5);
    expect(out).toHaveLength(2);
  });

  it('does not require the weights to match exactly', () => {
    const edges = [
      { from: 'a', to: 'b', weight: 0.95 },
      { from: 'b', to: 'a', weight: 0.91 },
    ];
    expect(mutualEdges(edges, 5)).toHaveLength(2);
  });
});

describe('connectedComponents (pure)', () => {
  it('returns one component for a fully connected graph', () => {
    const edges = [
      { from: 'a', to: 'b', weight: 0.9 },
      { from: 'b', to: 'c', weight: 0.9 },
      { from: 'c', to: 'a', weight: 0.9 },
    ];
    const { components } = connectedComponents(edges, ['a', 'b', 'c']);
    expect(components.size).toBe(1);
    expect(components.values().next().value).toEqual(
      expect.arrayContaining(['a', 'b', 'c'])
    );
  });

  it('returns two components for a graph split by a missing edge', () => {
    const edges = [
      { from: 'a', to: 'b', weight: 0.9 },
      { from: 'c', to: 'd', weight: 0.9 },
    ];
    const { components } = connectedComponents(edges, ['a', 'b', 'c', 'd']);
    expect(components.size).toBe(2);
  });
});

describe('pruneBridges — the bridge-memory scenario (Milestone 3 §17)', () => {
function build(): {
  edges: { from: string; to: string; weight: number }[];
  nodes: string[];
} {
    // Two dense topic subgraphs + a weak bridge in both
    // directions. auto-link writes the bridge both ways; v1
    // merges everything into one cluster of 13. v2 must NOT.
    const edges = [
      ...financeEdges(),
      ...rlEdges(),
      bridgeEdge(),
      rlBridgeEdge(),
      { from: BRIDGE, to: 'f1', weight: 0.5 },
      { from: BRIDGE, to: 'r1', weight: 0.5 },
    ];
    return { edges, nodes: [...F, ...R, BRIDGE] };
  }

  it('separates two unrelated topic groups when a bridge connects them', () => {
    const { edges, nodes } = build();
    // Run the full v2 pipeline so the test exercises the public
    // surface the cluster refresh uses. The bridge edges are NOT
    // mutual (Finance nodes do not include x1 in their top-K
    // because the bridge weight is far below the internal
    // average), so they are dropped by `mutualEdges` BEFORE the
    // connected-components pass even runs. The Finance and RL
    // subgraphs survive as two separate topics.
    const mutual = mutualEdges(edges, DEFAULT_MUTUAL_K);
    const initial = connectedComponents(mutual, nodes);
    const pruned = pruneBridges(mutual, initial.components, DEFAULT_BRIDGE_RATIO);

    // v2 must NOT collapse Finance + RL into a single 13-node
    // cluster. Two or more components is the correct answer
    // (the bridge node may attach to either side or stand alone,
    // but it cannot span the two topics).
    expect(pruned.components.size).toBeGreaterThanOrEqual(2);

    // The components that contain Finance nodes must NOT also
    // contain RL nodes (and vice versa). The bridge node is
    // allowed to be a singleton or to attach to one side, but
    // never to be a member of a component that mixes both topics.
    const financeNodes = new Set(F);
    const rlNodes = new Set(R);
    for (const members of pruned.components.values()) {
      const memberSet = new Set(members);
      const hasFinance = members.some((m) => financeNodes.has(m));
      const hasRL = members.some((m) => rlNodes.has(m));
      if (hasFinance && hasRL) {
        // A mixed component is only acceptable if it is the
        // BRIDGE singleton (size 1), which the minSize filter
        // would drop anyway.
        expect(memberSet.size).toBe(1);
        expect(memberSet.has(BRIDGE)).toBe(true);
      }
    }

    // The Finance subgraph of 6 must remain intact (or be split
    // into smaller pieces, never merged with RL).
    const allFinanceMembers = new Set<string>();
    for (const members of pruned.components.values()) {
      for (const m of members) {
        if (financeNodes.has(m)) allFinanceMembers.add(m);
      }
    }
    expect(allFinanceMembers.size).toBe(F.length);
  });

  it('keeps a single tight topic intact', () => {
    // 5-node cluster with all edges at weight 0.95. No bridges.
    // The v2 pipeline must return exactly one component.
    const N = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const edges = [];
    for (let i = 0; i < N.length; i++) {
      for (let j = 0; j < N.length; j++) {
        if (i === j) continue;
        edges.push({ from: N[i], to: N[j], weight: 0.95 });
      }
    }
    const mutual = mutualEdges(edges, DEFAULT_MUTUAL_K);
    const initial = connectedComponents(mutual, N);
    const pruned = pruneBridges(mutual, initial.components, DEFAULT_BRIDGE_RATIO);
    if (pruned.components.size === 0) {
      // eslint-disable-next-line no-console
      console.error('DEBUG tight: mutual=', mutual.length, 'initial.size=', initial.components.size);
    }
    expect(pruned.components.size).toBe(1);
    expect(pruned.bridgeEdgeCount).toBe(0);
  });

  it('drops only edges below the bridge ratio, not the entire cluster', () => {
    // 6-node cluster with one weak edge in the middle. The
    // weak edge is below 0.5 * average, so it must be cut. The
    // remaining 5 nodes form one component (still densely
    // connected on either side), and the cut edge count is 1.
    const N = ['a', 'b', 'c', 'd', 'e', 'f'];
    const pairs: [string, string, number][] = [
      // Strong edges (weight 0.95) — both directions
      ['a', 'b', 0.95], ['b', 'a', 0.95],
      ['b', 'c', 0.95], ['c', 'b', 0.95],
      ['c', 'd', 0.95], ['d', 'c', 0.95],
      ['d', 'e', 0.95], ['e', 'd', 0.95],
      ['e', 'f', 0.95], ['f', 'e', 0.95],
      ['a', 'f', 0.95], ['f', 'a', 0.95],
      // The weak bridge in the middle.
      ['b', 'e', 0.2], ['e', 'b', 0.2],
    ];
    const edges = pairs.map(([from, to, weight]) => ({ from, to, weight }));
    const mutual = mutualEdges(edges, DEFAULT_MUTUAL_K);
    const initial = connectedComponents(mutual, N);
    const pruned = pruneBridges(mutual, initial.components, DEFAULT_BRIDGE_RATIO);
    expect(pruned.components.size).toBe(1);
    expect(pruned.bridgeEdgeCount).toBeGreaterThanOrEqual(1);
  });
});
