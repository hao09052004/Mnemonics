/**
 * Content clusters — automatic grouping of memories by semantic
 * similarity.
 *
 * Design:
 *   - Algorithm: connected components over the existing `item_edges`
 *     graph of type `'similar'`. The edges are written by the
 *     embed-time auto-link pass (`apps/api/src/jobs/auto-link-similar.ts`),
 *     so the graph is already curated to "actually similar" pairs
 *     (cosine >= 0.78, top-5 nearest neighbours per embedded item).
 *     Connected components over a curated graph are the simplest
 *     clustering that:
 *       * handles an unknown number of clusters,
 *       * lets some memories stay unclustered (no edge => no group),
 *       * runs in one SQL statement,
 *       * costs O(N) in the size of the edge table, not O(N^2) over
 *         the embedding table.
 *   - Determinism: the cluster id is a stable hash of the sorted
 *     member ids. If the membership is the same, the id is the
 *     same; ordering of insertion does not change the id.
 *   - Representative: the member with the highest average cosine
 *     similarity to the other members (mean-edge centrality on
 *     the curated graph). Deterministic.
 *   - Title: deterministic keyword extraction from tags + titles +
 *     TLDRs. No paid AI required. The Ollama hook is layered on top
 *     by the route layer if the user has a local model configured,
 *     but the cluster itself is never blocked on naming.
 *
 * The module is pure: it has no I/O of its own, it only runs SQL
 * through the supplied `Pool`. Tests pass a fake pool to exercise
 * every code path without a database.
 */

import type { Pool, PoolClient } from 'pg';
import {
  mutualEdges,
  connectedComponents as connectedComponentsPure,
  pruneBridges,
  DEFAULT_BRIDGE_RATIO,
  DEFAULT_MUTUAL_K,
  type EdgeInput
} from './cluster-algorithm.js';

/** Minimum number of items in a cluster for it to be reported. */
export const DEFAULT_MIN_CLUSTER_SIZE = 3;

/**
 * The `similar` edges are written when cosine >= 0.78. We keep that
 * as the default cluster threshold so the cluster graph and the
 * related-items graph are computed on the same notion of "similar".
 * The user can lower it to find more, smaller clusters, or raise it
 * to find fewer, larger ones.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.78;

/** Maximum representative previews returned per cluster. */
const PREVIEW_SIZE = 4;

/** A cluster title is built from the top-K most salient tokens. */
const TITLE_KEYWORDS = 4;

/** Maximum items returned by the detail endpoint in a single page. */
export const CLUSTER_DETAIL_PAGE_SIZE = 50;

export interface ClusterConfig {
  minSize: number;
  similarityThreshold: number;
  /** Embedding model the clusters were computed against. Used to
   *  invalidate stale clusters when the model changes. */
  embeddingModel: string;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  minSize: DEFAULT_MIN_CLUSTER_SIZE,
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  embeddingModel: 'text-embedding-3-small'
};

export interface ClusterMember {
  itemId: string;
  /** Average cosine similarity to the other members. 0..1. */
  averageSimilarity: number;
}

export interface ClusterCandidate {
  /** Sorted member ids — the basis for the stable id. */
  memberIds: string[];
  /** Average intra-cluster edge weight. */
  averageEdgeWeight: number;
  /** One member, picked as the cover/headline. */
  representativeItemId: string;
  members: ClusterMember[];
}

/** The deterministic cluster id. Hex of a 64-bit FNV-1a hash of the
 *  sorted member ids joined by NUL. */
export function clusterIdForMembers(memberIds: string[]): string {
  if (memberIds.length === 0) {
    throw new Error('clusterIdForMembers requires at least one member id');
  }
  const sorted = [...memberIds].sort();
  // FNV-1a 64-bit
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const text = sorted.join('\u0000');
  for (let i = 0; i < text.length; i++) {
    hash = BigInt.asUintN(64, hash ^ BigInt(text.charCodeAt(i)));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Pick the member with the highest mean similarity to the rest.
 * Ties broken by `itemId` for full determinism.
 */
export function pickRepresentative(members: ClusterMember[]): string {
  if (members.length === 0) {
    throw new Error('pickRepresentative requires at least one member');
  }
  let best = members[0];
  for (let i = 1; i < members.length; i++) {
    const m = members[i];
    if (
      m.averageSimilarity > best.averageSimilarity ||
      (m.averageSimilarity === best.averageSimilarity && m.itemId < best.itemId)
    ) {
      best = m;
    }
  }
  return best.itemId;
}

/** English + Vietnamese stopwords. Lower-case, no punctuation. */
const STOPWORDS = new Set<string>([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'this', 'but', 'or', 'not', 'have', 'had', 'do', 'does',
  'did', 'if', 'so', 'they', 'we', 'you', 'i', 'me', 'my', 'we', 'our',
  // Vietnamese (lowercased, diacritics preserved)
  'và', 'là', 'của', 'cho', 'trong', 'một', 'những', 'các', 'đã', 'đang',
  'sẽ', 'với', 'khi', 'thì', 'này', 'kia', 'đó', 'như', 'thế', 'rồi',
  'có', 'không', 'thì', 'tôi', 'bạn', 'mình', 'chúng', 'ta', 'họ'
]);

/** Strip diacritics + lowercase for keyword matching. */
function fold(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(input: string): string[] {
  if (!input) return [];
  const folded = fold(input);
  // Split on non-letter, non-digit, non-underscore.
  return folded.split(/[^a-z0-9_]+/i).filter((t) => t.length >= 2);
}

export interface ClusterTextSignals {
  /** Map of normalised tag => weight (count). */
  tagCounts: Map<string, number>;
  /** Token => weight from titles/TLDRs. */
  tokenCounts: Map<string, number>;
}

/** Aggregate the signals we will mine for a title. */
export function collectSignals(
  members: Array<{ title: string | null; tldr: string | null; tags: string[] }>
): ClusterTextSignals {
  const tagCounts = new Map<string, number>();
  const tokenCounts = new Map<string, number>();
  for (const m of members) {
    for (const tag of m.tags) {
      const folded = fold(tag).trim();
      if (!folded || STOPWORDS.has(folded)) continue;
      tagCounts.set(folded, (tagCounts.get(folded) ?? 0) + 2);
    }
    const text = `${m.title ?? ''} ${m.tldr ?? ''}`;
    for (const tok of tokenize(text)) {
      if (STOPWORDS.has(tok)) continue;
      if (/^\d+$/.test(tok)) continue;
      tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1);
    }
  }
  return { tagCounts, tokenCounts };
}

/**
 * Build a deterministic 2..4 word cluster title.
 *
 * v2 upgrade: instead of a keyword dump ("A & B & C & D"), we
 * look for topic-coherent phrases:
 *
 *  - We try the top tag first (if its length is meaningful). The
 *    top tag is the single most discriminating signal in the
 *    cluster because tags are user-curated, not extracted from
 *    narrative prose.
 *  - We pair it with the second tag that is NOT a substring or
 *    superstring of the first. The pair reads as "Topic A & Topic
 *    B", which is a useful disambiguation when the cluster
 *    straddles two sub-topics of the same field.
 *  - If tags are sparse, we fall back to the top two
 *    non-stopword, non-trivial tokens from the titles / TLDRs.
 *  - As a last resort, we accept a single long token (>= 6 chars)
 *    as the title. This avoids the empty "Untitled" fallback
 *    for narrow clusters with a single clear topic.
 *
 * The function is pure and deterministic; the same members
 * produce the same title. The cluster is never blocked on
 * LLM-based naming: spec §31 forbids depending on a paid model,
 * and the local Ollama path runs after this function has
 * already produced a stable fallback.
 */
export function buildClusterTitle(
  signals: ClusterTextSignals,
  membersCount: number
): string | null {
  if (membersCount < 2) return null;
  const tagEntries = [...signals.tagCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const tokenEntries = [...signals.tokenCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  // 1) Try a tag + tag pair. Both must be at least 3 chars and
  //    not a string-prefix of each other (so "barrier" + "barrier
  //    function" would be collapsed, but "barrier" + "reward" stay
  //    distinct).
  const usableTags = tagEntries
    .map(([w]) => w)
    .filter((w) => w.length >= 3);
  if (usableTags.length >= 2) {
    const first = usableTags[0];
    const second = usableTags.find(
      (w) => w !== first && !w.startsWith(first) && !first.startsWith(w)
    );
    if (second) {
      return `${capitalise(first)} ${capitalise(second)}`;
    }
    return capitalise(first);
  }
  if (usableTags.length === 1) {
    return capitalise(usableTags[0]);
  }

  // 2) Token fallback: top two non-trivial tokens. "Trivial" here
  //    means short (< 5 chars) and present in the stopword set,
  //    or pure digits. We prefer longer words because they carry
  //    more topical signal.
  const usableTokens = tokenEntries
    .map(([w]) => w)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  if (usableTokens.length >= 2) {
    return `${capitalise(usableTokens[0])} ${capitalise(usableTokens[1])}`;
  }
  if (usableTokens.length === 1) {
    return capitalise(usableTokens[0]);
  }

  // 3) Last resort: medium-length token (>= 4 chars). Better than
  //    a blank header on a sparse cluster.
  const mediumTokens = tokenEntries
    .map(([w]) => w)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (mediumTokens.length > 0) {
    return capitalise(mediumTokens[0]);
  }

  return null;
}

function capitalise(word: string): string {
  if (!word) return word;
  // Lowercase is the canonical form for Vietnamese; for English
  // we capitalise the first letter and keep the rest as the
  // tag/title contributed it. Diacritics are preserved (the
  // folded form is used only for matching, not for display).
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Public shape of the cluster DB row. */
export interface ContentCluster {
  id: string;
  userId: string;
  signature: string;
  title: string | null;
  summary: string | null;
  representativeItemId: string | null;
  itemCount: number;
  algorithmVersion: string;
  embeddingModel: string;
  similarityThreshold: number;
  minSize: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface ContentClusterItem {
  clusterId: string;
  itemId: string;
  score: number;
  rank: number;
}

export interface ClusterPreviewItem {
  id: string;
  kind: string;
  title: string;
  thumbnailUrl: string | null;
  isFavorite: boolean;
}

export interface ContentClusterSummary extends ContentCluster {
  previewItems: ClusterPreviewItem[];
}

export interface ClusterRefreshResult {
  algorithmVersion: string;
  embeddingModel: string;
  similarityThreshold: number;
  minSize: number;
  eligibleItemCount: number;
  clusterCount: number;
  unclusteredCount: number;
  clusters: ContentClusterSummary[];
  durationMs: number;
}

export interface ClusterRefreshDeps {
  pool: Pool;
  config?: Partial<ClusterConfig>;
}

export interface ClusterRepository {
  /**
   * Recompute every cluster for the user. Replaces the previous
   * snapshot in a single transaction.
   */
  refresh(userId: string, deps?: ClusterRefreshDeps): Promise<ClusterRefreshResult>;

  /** List clusters for the user. Empty array if none / disabled. */
  list(userId: string, pool: Pool): Promise<ContentClusterSummary[]>;

  /** Single cluster detail. */
  get(clusterId: string, userId: string, pool: Pool): Promise<ContentClusterSummary | null>;

  /** Item ids in cluster order, paginated. */
  listItemIds(
    clusterId: string,
    userId: string,
    pool: Pool,
    limit?: number,
    offset?: number
  ): Promise<string[]>;

  /**
   * Hydrated, lightweight item DTOs for a cluster page. The fields
   * are the same ones the dashboard `MemoryCard` renders, so the
   * detail endpoint can answer in one round trip instead of having
   * the client filter the global `items` list. Only the fields the
   * detail page actually needs are returned: no raw PDF text, no
   * OCR text, no original image bytes, no enrichments.
   */
  listItemSummaries(
    clusterId: string,
    userId: string,
    pool: Pool,
    limit?: number,
    offset?: number
  ): Promise<ClusterItemSummary[]>;

  /** The current cluster a single item belongs to (if any). */
  clusterForItem(itemId: string, userId: string, pool: Pool): Promise<ContentClusterSummary | null>;
}

/**
 * Lightweight DTO for a single cluster member. Mirrors the
 * `MemoryCard` inputs so the detail page can render a member
 * without a second round trip to fetch the parent item.
 */
export interface ClusterItemSummary {
  id: string;
  kind: string;
  title: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  capturedAt: Date;
  isFavorite: boolean;
  /** Rank inside the cluster, starting at 0. Stable across pages. */
  rank: number;
}

const ALGORITHM_VERSION = 'cc-mutual-bridges-v1';
const LEGACY_ALGORITHM_VERSION = 'cc-on-edges-v1';

/**
 * Algorithm version stamped on every cluster row. Bumping this
 * invalidates every existing cluster for the user on the next
 * refresh — the `algorithmVersion` comparison in the route
 * layer signals "stale snapshot" so the UI can offer a refresh
 * rather than showing clusters from an old algorithm run.
 */
export const CLUSTER_ALGORITHM_VERSION = ALGORITHM_VERSION;

/**
 * Run the v2 clustering pass: mutual-kNN gate + bridge pruning.
 *
 * The v1 algorithm (connected components on every edge above the
 * threshold) suffered from single-link chaining: a weak bridge
 * between two unrelated topics would merge them. v2 adds:
 *
 *   1. **Mutual-kNN gate**: keep only edges where the two items
 *      are each in the other's top-K nearest neighbours. This
 *      filters out one-way noise (an isolated item that is
 *      "close" to many items but has no true peers).
 *   2. **Bridge pruning**: after connected components are
 *      formed, drop intra-cluster edges whose weight is below
 *      `BRIDGE_RATIO * internalAverage`. This may split a
 *      component into two or more honest topics.
 *
 * The whole pipeline is two SQL queries (load edges, load
 * metadata) plus pure-JS algorithm code in `cluster-algorithm.ts`.
 * The SQL portion is unchanged from v1 because the gate is
 * applied AFTER the edges are loaded; this keeps the v2 change
 * additive and easy to test without database state.
 */
async function computeComponents(
  client: Pool | PoolClient,
  userId: string,
  config: ClusterConfig
): Promise<ClusterCandidate[]> {
  // Step 1: load the relevant edges. The v1 SQL already filters
  // by user, edge type, and threshold. We just need the data in
  // a flat list.
  const edgesResult = await client.query<{
    from_item_id: string;
    to_item_id: string;
    weight: number;
  }>(
    `SELECT from_item_id, to_item_id, weight
       FROM item_edges
      WHERE user_id = $1
        AND edge_type = 'similar'
        AND weight >= $2`,
    [userId, config.similarityThreshold]
  );
  if (edgesResult.rowCount === 0) return [];

  const edges: EdgeInput[] = edgesResult.rows.map((r) => ({
    from: String(r.from_item_id),
    to: String(r.to_item_id),
    weight: Number(r.weight),
  }));
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.from);
    allNodes.add(e.to);
  }
  // Edges are written both directions by auto-link, so the
  // union-find sees (a, b) and (b, a) for every true pair. The
  // mutual-kNN gate would treat them as a single edge weight,
  // so we dedupe before scoring. The cluster id and component
  // count are independent of edge multiplicity.
  const dedup = new Map<string, EdgeInput>();
  for (const e of edges) {
    const key = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    if (!dedup.has(key)) dedup.set(key, e);
  }
  const uniqueEdges: EdgeInput[] = [];
  for (const e of dedup.values()) {
    uniqueEdges.push(e);
    uniqueEdges.push({ from: e.to, to: e.from, weight: e.weight });
  }
  const mutual = mutualEdges(uniqueEdges, DEFAULT_MUTUAL_K);
  if (mutual.length === 0) return [];

  const initial = connectedComponentsPure(
    mutual,
    Array.from(allNodes)
  );
  const pruned = pruneBridges(
    mutual,
    initial.components,
    DEFAULT_BRIDGE_RATIO
  );

  // Step 2: build member lists. minSize filter is applied here so
  // the downstream SQL doesn't fetch metadata for clusters we
  // will drop anyway.
  const eligible: { memberIds: string[]; averageEdgeWeight: number }[] = [];
  for (const [cid, members] of pruned.components.entries()) {
    if (members.length < config.minSize) continue;
    const avg = pruned.clusterAvgWeight.get(cid) ?? 0;
    eligible.push({ memberIds: members, averageEdgeWeight: avg });
  }
  if (eligible.length === 0) return [];

  // Step 3: load member metadata. The mean-similarity per member
  // is recomputed against the SURVIVING edges, not the original
  // v1 graph. A member whose bridges were cut is judged by the
  // edges that remain — fairer to the cluster.
  const allMemberIds = eligible.flatMap((c) => c.memberIds);
  const memberSet = new Set(allMemberIds);
  const survivingInCluster = new Map<string, EdgeInput[]>();
  for (const e of pruned.survivingEdges) {
    if (!memberSet.has(e.from) || !memberSet.has(e.to)) continue;
    const key = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    let list = survivingInCluster.get(key);
    if (!list) {
      list = [];
      survivingInCluster.set(key, list);
    }
    list.push(e);
  }
  const meanByItem = new Map<string, number>();
  for (const itemId of allMemberIds) {
    const neighbours = pruned.survivingEdges
      .filter((e) => e.from === itemId && memberSet.has(e.to))
      .map((e) => e.weight);
    meanByItem.set(
      itemId,
      neighbours.length > 0
        ? neighbours.reduce((s, w) => s + w, 0) / neighbours.length
        : 0
    );
  }

  const candidates: ClusterCandidate[] = [];
  for (const c of eligible) {
    const members: ClusterMember[] = c.memberIds.map((id) => ({
      itemId: id,
      averageSimilarity: meanByItem.get(id) ?? 0,
    }));
    const representativeItemId = pickRepresentative(members);
    candidates.push({
      memberIds: c.memberIds,
      averageEdgeWeight: c.averageEdgeWeight,
      representativeItemId,
      members,
    });
  }
  return candidates;
}

/** Build the deterministic metadata (title, summary) for a cluster. */
async function buildClusterMetadata(
  client: Pool | PoolClient,
  candidates: ClusterCandidate[]
): Promise<Map<string, { title: string | null; summary: string | null }>> {
  const out = new Map<string, { title: string | null; summary: string | null }>();
  if (candidates.length === 0) return out;

  const allIds = candidates.flatMap((c) => c.memberIds);
  const metaResult = await client.query<{
    item_id: string;
    title: string | null;
    tldr: string | null;
    tags: string[];
  }>(
    `SELECT i.id AS item_id, i.title, e.tldr,
            COALESCE(
              (SELECT array_agg(t.name ORDER BY t.name)
                 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                WHERE it.item_id = i.id),
              ARRAY[]::text[]
            ) AS tags
       FROM items i
       LEFT JOIN item_enrichments e ON e.item_id = i.id
      WHERE i.id = ANY($1::uuid[])`,
    [allIds]
  );

  const byItem = new Map<string, { title: string | null; tldr: string | null; tags: string[] }>();
  for (const r of metaResult.rows) {
    byItem.set(String(r.item_id), {
      title: r.title,
      tldr: r.tldr,
      tags: r.tags ?? []
    });
  }

  for (const c of candidates) {
    const id = clusterIdForMembers(c.memberIds);
    const members = c.memberIds.map((mid) => byItem.get(mid) ?? { title: null, tldr: null, tags: [] });
    const signals = collectSignals(members);
    const title = buildClusterTitle(signals, c.memberIds.length);
    // No-AI summary: short list of the top tags. If a T-Summariser
    // is added later, it replaces this string.
    const summary = title
      ? `Memories about ${signals.tagCounts.size > 0
          ? [...signals.tagCounts.keys()].slice(0, 3).join(', ')
          : title.toLowerCase()}.`
      : null;
    out.set(id, { title, summary });
  }
  return out;
}

async function loadPreviews(
  client: Pool | PoolClient,
  userId: string,
  representativeIds: string[]
): Promise<Map<string, ClusterPreviewItem[]>> {
  const out = new Map<string, ClusterPreviewItem[]>();
  if (representativeIds.length === 0) return out;

  // For each representative, fetch up to PREVIEW_SIZE more members
  // from the same cluster. We do this with one query that joins
  // cluster_id -> preview items, then a second pass to filter by
  // the per-cluster top-N. Because we already returned at most 4
  // previews per cluster, this is a single scan.
  const result = await client.query<{
    item_id: string;
    type: string | null;
    title: string | null;
    is_favorite: boolean | null;
  }>(
    `SELECT i.id AS item_id, i.type, i.title, i.is_favorite
       FROM unnest($2::uuid[]) AS rep(rep_id)
       JOIN content_cluster_items cci ON cci.cluster_id = (
         SELECT cluster_id FROM content_cluster_items
          WHERE item_id = rep.rep_id
          LIMIT 1
       )
       JOIN items i ON i.id = cci.item_id AND i.user_id = $1
      WHERE i.user_id = $1
        AND i.status = 'ready'
      ORDER BY cci.cluster_id, cci.rank ASC
      LIMIT 100`,
    [userId, representativeIds]
  );

  // Group by cluster_id (looked up by the rep_id -> cluster mapping)
  const repToCluster = new Map<string, string>();
  const clusterLookup = await client.query<{ item_id: string; cluster_id: string }>(
    `SELECT item_id, cluster_id
       FROM content_cluster_items
      WHERE item_id = ANY($1::uuid[])`,
    [representativeIds]
  );
  for (const r of clusterLookup.rows) {
    repToCluster.set(String(r.item_id), String(r.cluster_id));
  }

  for (const row of result.rows) {
    const repId = String(row.item_id);
    const clusterId = repToCluster.get(repId);
    if (!clusterId) continue;
    const list = out.get(clusterId) ?? [];
    if (list.length < PREVIEW_SIZE) {
      list.push({
        id: String(row.item_id),
        kind: String(row.type ?? 'text'),
        title: String(row.title ?? ''),
        thumbnailUrl: null,
        isFavorite: Boolean(row.is_favorite)
      });
      out.set(clusterId, list);
    }
  }
  return out;
}

export function createClusterRepository(): ClusterRepository {
  return {
    async refresh(userId, deps): Promise<ClusterRefreshResult> {
      if (!userId) throw new Error('userId is required');
      const pool = deps?.pool as Pool;
      if (!pool) throw new Error('Pool is required for cluster refresh');
      const config: ClusterConfig = { ...DEFAULT_CLUSTER_CONFIG, ...(deps?.config ?? {}) };
      const startedAt = Date.now();

      // Single transaction: compute, drop old snapshot, write new snapshot.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const candidates = await computeComponents(client, userId, config);
        const metadata = await buildClusterMetadata(client, candidates);

        // Drop existing rows for this user.
        await client.query(
          `DELETE FROM content_cluster_items
            WHERE cluster_id IN (
              SELECT id FROM content_clusters WHERE user_id = $1
            )`,
          [userId]
        );
        await client.query(`DELETE FROM content_clusters WHERE user_id = $1`, [userId]);

        // Eligible / unclustered counts for the response.
        const countResult = await client.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
             FROM items
            WHERE user_id = $1 AND status = 'ready'`
          ,
          [userId]
        );
        const eligibleItemCount = Number(countResult.rows[0]?.total ?? 0);
        const clusteredIds = new Set(candidates.flatMap((c) => c.memberIds));
        const unclusteredCount = Math.max(0, eligibleItemCount - clusteredIds.size);

        // Write new clusters.
        const clusterIdToCandidate = new Map<string, ClusterCandidate>();
        for (const c of candidates) {
          const id = clusterIdForMembers(c.memberIds);
          clusterIdToCandidate.set(id, c);
        }

        const inserted: { id: string; candidate: ClusterCandidate }[] = [];
        for (const [id, c] of clusterIdToCandidate.entries()) {
          const meta = metadata.get(id) ?? { title: null, summary: null };
          const insertResult = await client.query<{ id: string }>(
            `INSERT INTO content_clusters
               (id, user_id, signature, title, summary, representative_item_id,
                item_count, average_edge_weight,
                algorithm_version, embedding_model,
                similarity_threshold, min_size)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [
              id,
              userId,
              id,
              meta.title,
              meta.summary,
              c.representativeItemId,
              c.memberIds.length,
              c.averageEdgeWeight,
              ALGORITHM_VERSION,
              config.embeddingModel,
              config.similarityThreshold,
              config.minSize
            ]
          );
          inserted.push({ id: String(insertResult.rows[0].id), candidate: c });
        }

        // Write cluster membership rows.
        for (const { id, candidate } of inserted) {
          for (let i = 0; i < candidate.memberIds.length; i++) {
            await client.query(
              `INSERT INTO content_cluster_items (cluster_id, item_id, score, rank)
               VALUES ($1, $2, $3, $4)`,
              [id, candidate.memberIds[i], candidate.members[i].averageSimilarity, i]
            );
          }
        }

        // Build summary objects.
        const repIds = inserted.map((row) => row.candidate.representativeItemId);
        const previewMap = await loadPreviews(client, userId, repIds);

        await client.query('COMMIT');

        const clusters: ContentClusterSummary[] = inserted.map((row) => ({
          id: row.id,
          userId,
          signature: row.id,
          title: metadata.get(row.id)?.title ?? null,
          summary: metadata.get(row.id)?.summary ?? null,
          representativeItemId: row.candidate.representativeItemId,
          itemCount: row.candidate.memberIds.length,
          algorithmVersion: ALGORITHM_VERSION,
          embeddingModel: config.embeddingModel,
          similarityThreshold: config.similarityThreshold,
          minSize: config.minSize,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          previewItems: previewMap.get(row.id) ?? []
        }));

        return {
          algorithmVersion: ALGORITHM_VERSION,
          embeddingModel: config.embeddingModel,
          similarityThreshold: config.similarityThreshold,
          minSize: config.minSize,
          eligibleItemCount,
          clusterCount: inserted.length,
          unclusteredCount,
          clusters,
          durationMs: Date.now() - startedAt
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async list(userId, pool) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT * FROM content_clusters
          WHERE user_id = $1
          ORDER BY item_count DESC, updated_at DESC`,
        [userId]
      );
      const rows = result.rows.map(toCluster);
      if (rows.length === 0) return [];
      const repIds = rows.map((r) => r.representativeItemId).filter((v): v is string => !!v);
      const previews = await loadPreviews(pool, userId, repIds);
      return rows.map((row) => ({
        ...row,
        previewItems: previews.get(row.id) ?? []
      }));
    },

    async get(clusterId, userId, pool) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT * FROM content_clusters WHERE id = $1 AND user_id = $2`,
        [clusterId, userId]
      );
      if (!result.rows[0]) return null;
      const row = toCluster(result.rows[0]);
      const repIds = row.representativeItemId ? [row.representativeItemId] : [];
      const previews = await loadPreviews(pool, userId, repIds);
      return { ...row, previewItems: previews.get(row.id) ?? [] };
    },

    async listItemIds(clusterId, userId, pool, limit = CLUSTER_DETAIL_PAGE_SIZE, offset = 0) {
      const result = await pool.query<{ item_id: string }>(
        `SELECT cci.item_id
           FROM content_cluster_items cci
           JOIN content_clusters cc ON cc.id = cci.cluster_id
          WHERE cci.cluster_id = $1 AND cc.user_id = $2
          ORDER BY cci.rank ASC, cci.item_id
          LIMIT $3 OFFSET $4`,
        [clusterId, userId, limit, offset]
      );
      return result.rows.map((r) => String(r.item_id));
    },

    async listItemSummaries(clusterId, userId, pool, limit = CLUSTER_DETAIL_PAGE_SIZE, offset = 0) {
      // The user-scoped predicate is repeated on `items` so a
      // hijacked cluster id from another user cannot leak rows even
      // if the content_clusters RLS policy is bypassed (RLS is
      // normally enforced at the table level, but tests and the
      // development-token auth path skip it). We select only the
      // fields MemoryCard actually needs — never the full row, and
      // never the raw text. The thumbnail is fetched from the first
      // image asset on the item; non-image items simply get null.
      const result = await pool.query<{
        item_id: string;
        type: string;
        title: string | null;
        thumbnail_storage_key: string | null;
        source_url: string | null;
        captured_at: Date;
        is_favorite: boolean;
        rank: number;
      }>(
        `SELECT
           cci.item_id,
           cci.rank,
           i.type,
           i.title,
           i.source_url,
           i.captured_at,
           COALESCE(i.is_favorite, false) AS is_favorite,
           (
             SELECT a.storage_key
               FROM assets a
              WHERE a.item_id = cci.item_id
                AND a.mime_type LIKE 'image/%'
              ORDER BY a.created_at ASC
              LIMIT 1
           ) AS thumbnail_storage_key
         FROM content_cluster_items cci
         JOIN content_clusters cc
           ON cc.id = cci.cluster_id
          AND cc.user_id = $2
         JOIN items i
           ON i.id = cci.item_id
          AND i.user_id = $2
         WHERE cci.cluster_id = $1
         ORDER BY cci.rank ASC, cci.item_id
         LIMIT $3 OFFSET $4`,
        [clusterId, userId, limit, offset]
      );
      return result.rows.map((row) => ({
        id: String(row.item_id),
        kind: String(row.type),
        title: row.title,
        thumbnailUrl: row.thumbnail_storage_key
          ? `/api/v1/assets/${encodeURIComponent(row.thumbnail_storage_key)}`
          : null,
        sourceUrl: row.source_url,
        capturedAt: new Date(row.captured_at),
        isFavorite: Boolean(row.is_favorite),
        rank: Number(row.rank),
      }));
    },

    async clusterForItem(itemId, userId, pool) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT cc.*
           FROM content_clusters cc
           JOIN content_cluster_items cci ON cci.cluster_id = cc.id
          WHERE cci.item_id = $1 AND cc.user_id = $2
          LIMIT 1`,
        [itemId, userId]
      );
      if (!result.rows[0]) return null;
      const row = toCluster(result.rows[0]);
      const repIds = row.representativeItemId ? [row.representativeItemId] : [];
      const previews = await loadPreviews(pool, userId, repIds);
      return { ...row, previewItems: previews.get(row.id) ?? [] };
    }
  };
}

function toCluster(row: Record<string, unknown>): ContentCluster {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    signature: String(row.signature ?? row.id),
    title: (row.title as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    representativeItemId: (row.representative_item_id as string | null) ?? null,
    itemCount: Number(row.item_count ?? 0),
    algorithmVersion: String(row.algorithm_version ?? ALGORITHM_VERSION),
    embeddingModel: String(row.embedding_model ?? ''),
    similarityThreshold: Number(row.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD),
    minSize: Number(row.min_size ?? DEFAULT_MIN_CLUSTER_SIZE),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null
  };
}
