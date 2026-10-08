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
