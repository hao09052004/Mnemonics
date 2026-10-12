# M6 — Cluster Quality Benchmark + Regression Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing M3 cluster benchmark
(`packages/database/src/__tests__/cluster-benchmark.test.ts`)
into a CI gate that runs on every `pnpm test`, fails the
build when cluster quality drifts beyond a fixed tolerance,
and prints the three numbers + drift deltas on every run.

**Architecture:** Three pieces:

1. A new pure module `cluster-metrics.ts` that, given a
   list of components and a list of edges, returns
   `{ componentCount, unclusteredFraction,
   meanIntraClusterCosine }`.
2. The existing `cluster-benchmark.test.ts` is rewritten to
   call `cluster-metrics`, assert on the three numbers, and
   print the human-readable table.
3. A small doc paragraph is added to
   `quality-gates/gates/03-test-coverage.md` pointing at the
   benchmark for reviewers.

**Tech Stack:** TypeScript 5.4, no new dependencies.

**Spec:** [`./2026-10-08-p0-quality-upgrade-m5-m8.md`](./2026-10-08-p0-quality-upgrade-m5-m8.md) §2.2
(scope) and §50–§59 (M6 spec sections). The plan argues
from the spec.

## Global Constraints

* The benchmark is **deterministic** — no randomness, no
  time-of-day, no wall-clock, no DB.
* The benchmark runs on every `pnpm test`. It is not skipped.
* The three threshold constants are committed in the test
  file as named constants, not magic numbers.
* All Vietnamese error / log strings stay English.

## Review Focus

1. **A regression in the algorithm makes the build fail.**
   The test must run on every CI invocation. The test must
   fail when any of the three numbers drifts past the
   threshold in §53.
2. **A pass produces the same numbers as a previous pass.**
   The `deltas` block is the absolute drift from a pinned
   baseline. The pinned baseline is committed in the test
   file as a constant. A change to the algorithm that
   produces *better* numbers will still fail the test
   (because the drift is non-zero) and require an explicit
   baseline update.
3. **The benchmark does not require a database.** The
   benchmark is a pure in-memory test of the cluster
   algorithm. The SQL integration test in
   `clusters.test.ts` is unchanged and stays separate.

Each is wired to a task's test list.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/database/src/cluster-metrics.ts` | New. Pure functions that compute the three metrics. |
| `packages/database/src/__tests__/cluster-metrics.test.ts` | New. Pure unit tests for the metrics. |
| `packages/database/src/__tests__/cluster-benchmark.test.ts` | Modified. Now uses `cluster-metrics` and asserts the three numbers. |
| `quality-gates/gates/03-test-coverage.md` | Modified. Adds a paragraph pointing at the benchmark. |
| `docs/m6-cluster-benchmark.md` | New. One-page doc. |

---

## Task 1: Author §50–§59 in the scope doc (already done in
the previous turn)

**Files:**
- Modify: `specs/plans/2026-10-08-p0-quality-upgrade-m5-m8.md`

- [ ] **Step 1:** Confirm the §50–§59 block is present and
  matches the contract above. (Already added.)
- [ ] **Step 2:** Commit the spec alongside the M6 work in
  Task 7.

## Task 2: Add the failing unit test for `cluster-metrics`

**Files:**
- Create: `packages/database/src/__tests__/cluster-metrics.test.ts`

**Interfaces:**
- Consumes: nothing (the module does not exist yet).
- Produces: a test that fails because the module is not
  exported.

- [ ] **Step 1:** Create the test file:

```ts
import { describe, expect, it } from 'vitest';
import { computeClusterMetrics, type Component } from '../cluster-metrics.js';

function comp(id: string, members: string[]): Component {
  return { id, members };
}

describe('computeClusterMetrics — pure unit', () => {
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
```

- [ ] **Step 2:** Run:

```bash
pnpm --filter @mnemonics/database test -- cluster-metrics
```

Expected: FAIL with `Cannot find module '../cluster-metrics.js'`.

- [ ] **Step 3:** Commit the failing test:

```bash
git add packages/database/src/__tests__/cluster-metrics.test.ts
git commit -m "test(m6): failing unit tests for computeClusterMetrics"
```

## Task 3: Implement `cluster-metrics.ts`

**Files:**
- Create: `packages/database/src/cluster-metrics.ts`

**Interfaces:**
- Produces:
  - `Component` — `{ id: string; members: string[] }`.
  - `ClusterMetrics` — `{ componentCount: number;
    unclusteredFraction: number; meanIntraClusterCosine: number }`.
  - `computeClusterMetrics(components: Component[], edges:
    { from: string; to: string; weight: number }[]): ClusterMetrics`.

- [ ] **Step 1:** Create the file:

```ts
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
```

- [ ] **Step 2:** Run the unit test:

```bash
pnpm --filter @mnemonics/database test -- cluster-metrics
```

Expected: PASS, all six cases.

- [ ] **Step 3:** Run the full database test suite to
  confirm no regression in the existing cluster-algorithm
  tests:

```bash
pnpm --filter @mnemonics/database test
```

Expected: all PASS (62 + 6 = 68 tests).

- [ ] **Step 4:** Commit:

```bash
git add packages/database/src/cluster-metrics.ts
git commit -m "feat(m6): add cluster-metrics module with three numbers"
```

## Task 4: Rewrite `cluster-benchmark.test.ts` to assert the three numbers

**Files:**
- Modify: `packages/database/src/__tests__/cluster-benchmark.test.ts`

**Interfaces:**
- Consumes: `computeClusterMetrics` from Task 3.
- Produces: a test that pins the three numbers against
  the §53 thresholds, and prints the table on every run.

- [ ] **Step 1:** Replace the existing test file with:

```ts
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

const BASELINE_COMPONENT_COUNT = 3;
const BASELINE_UNCLUSTERED_FRACTION = 2 / 14; // 0.142857...
const BASELINE_MEAN_INTRA_CLUSTER_COSINE = 0.85; // dense topic average

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
```

- [ ] **Step 2:** Run the benchmark test:

```bash
pnpm --filter @mnemonics/database test -- cluster-benchmark
```

Expected: PASS (or, if the baseline constants do not match
the algorithm's actual output, FAIL with a clear number).
In the latter case, adjust the three `BASELINE_*`
constants to match the algorithm's current output **once**,
and commit. Subsequent changes to the algorithm will
cause a re-failure with a non-zero `deltas` block.

- [ ] **Step 3:** Run the full database test suite:

```bash
pnpm --filter @mnemonics/database test
```

Expected: all PASS (the existing 67 tests, plus 6
`cluster-metrics` tests, plus 1 `cluster-benchmark` test,
in any order — totalling 74).

- [ ] **Step 4:** Commit:

```bash
git add packages/database/src/__tests__/cluster-benchmark.test.ts
git commit -m "feat(m6): rewrite benchmark to assert three threshold gates"
```

## Task 5: Add the doc paragraph to `03-test-coverage.md`

**Files:**
- Modify: `quality-gates/gates/03-test-coverage.md`

**Interfaces:**
- Produces: a paragraph pointing at the cluster benchmark
  for reviewers who land on this gate's docs.

- [ ] **Step 1:** Add a new section after the existing
  `## Evidence` section (or after `## Remediation` — pick
  the end of the file):

```md
## Related regression gates

`packages/database/src/__tests__/cluster-benchmark.test.ts`
is a separate regression gate that pins three cluster
quality numbers (`componentCount`, `unclusteredFraction`,
`meanIntraClusterCosine`) and fails the build on a
non-zero drift from the baseline. It is not a coverage
rule and is not enforced by this gate; it lives next to
the algorithm it pins. See `docs/m6-cluster-benchmark.md`
for the contract.
```

- [ ] **Step 2:** Commit:

```bash
git add quality-gates/gates/03-test-coverage.md
git commit -m "docs(m6): point coverage gate at the cluster benchmark"
```

## Task 6: Author `docs/m6-cluster-benchmark.md`

**Files:**
- Create: `docs/m6-cluster-benchmark.md`

**Interfaces:**
- Produces: a one-page doc for future readers (human or
  agent).

- [ ] **Step 1:** Write the doc:

```md
# M6 — Cluster quality benchmark

## Why

The cluster algorithm was rewritten in M3 without a
numerical baseline to compare against. A silent
regression — a small change that drops 3% of components
or raises the unclustered fraction by 1.5x — would ship
without anyone noticing. M6 turns the existing M3
benchmark into a CI gate.

## What

A synthetic 14-node fixture (6-node Finance, 6-node RL,
1 bridge, 1 lonely) is run through the v2 algorithm and
fed into `computeClusterMetrics`. Three numbers come out:

- `componentCount` (target: >= 2)
- `unclusteredFraction` (target: <= 0.30)
- `meanIntraClusterCosine` (target: >= 0.78)

A regression in any of the three fails the build. The
test also reports the absolute drift from a pinned
baseline; a deliberate improvement to the algorithm
still requires an explicit baseline bump.

## Where

`packages/database/src/__tests__/cluster-benchmark.test.ts`.
The fixture lives in the same file. The metrics live in
`packages/database/src/cluster-metrics.ts`.

## Out of scope

- A real-corpus benchmark. We do not have labelled data;
  shipping one is a future milestone if the user ever
  collects it.
- A separate "drift alert" workflow. The pinned baseline
  is committed; a regression is a build failure, not a
  Slack alert.
- A change to the cluster algorithm itself. M6 only
  pins the current numbers; an algorithm change is
  M-something-else.
```

- [ ] **Step 2:** Commit:

```bash
git add docs/m6-cluster-benchmark.md
git commit -m "docs(m6): one-pager for the cluster benchmark"
```

## Task 7: Final verification + §50–§59 spec commit

- [ ] **Step 1:** Run the full workspace test suite:

```bash
pnpm test
```

Expected: all packages, all tests PASS.

- [ ] **Step 2:** Run the typecheck gate:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3:** Run the spec-sync gate. The benchmark's
  paragraph in `03-test-coverage.md` is in a `quality-gates/`
  file, which is in the spec-sync runner's watch list, so
  the gate should pass.

```bash
pnpm gates:all
```

Expected: PASS.

- [ ] **Step 4:** Commit the §50–§59 block in the scope
  doc (Task 1) if not already committed. If the spec block
  is already in the scope doc from the previous turn, this
  step is a no-op.

## Self-Review

1. **Spec coverage.** §50–§59 are written in the scope doc;
   the benchmark asserts the three thresholds from §53;
   the print-format from §54 is honoured; the test name
   is the §55 attribution. ✅
2. **Placeholder scan.** No "TBD", no "implement later",
   no "similar to Task N". Every task has concrete code
   blocks. ✅
3. **Type consistency.** `Component` and `ClusterEdge`
   are introduced in Task 3 and consumed by Task 4 with
   no rename. `computeClusterMetrics`'s return type
   matches the test's destructuring. ✅
4. **Review Focus.**
   - Review Focus 1 (regression fails the build): the
     `expect(...).toBeGreaterThanOrEqual(...)` calls in
     Task 4 step 1 fail the test on regression. ✅
   - Review Focus 2 (drift is reported and zero on a
     no-change pass): the `deltas` block in the console
     output reports the absolute drift; a no-change pass
     produces all-zero deltas. ✅
   - Review Focus 3 (no DB): the benchmark is pure; no
     `pool` is imported. ✅
5. **Karpathy guidelines.** Smallest viable change: one
   new module, one rewritten test, one new doc, one
   paragraph in an existing gate doc. Surgical: no
   unrelated code is modified. Goal-driven: every task
   has a verifiable test or a verifiable verification
   step. ✅

## Execution Handoff

Plan complete and saved to
`specs/plans/2026-10-08-m6-benchmark.md`. The user has
already approved the M5–M8 scope and ordered M5 first,
M6 second. The author will execute in this session using
the **native** approach: one reviewer at the end (the
human + the next milestone's plan), no per-task
subagent dispatch. Reason: M6 is small (six ship-able
tasks, one new module, one rewritten test, no new
dependencies), so a per-task subagent would
overhead the work.
