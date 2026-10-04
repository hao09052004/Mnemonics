/**
 * Server-backed Spaces — types + repository.
 *
 * Two kinds, one table (`spaces.space_type` disambiguates):
 *
 *   manual — the user picked the memories. Membership is persisted in
 *            `space_items` and only changes when the user acts.
 *   smart  — the user saved *criteria*. Membership is recomputed on
 *            every read by handing the stored `rule` to the shared
 *            search service (`search-service.ts`). Nothing is
 *            materialised, so a memory captured after the Space was
 *            created shows up on the next visit with no write, no job
 *            and no sync step.
 *
 * Consequences of the smart design that callers must respect:
 *   * `itemCount` is cheap for a manual Space (a COUNT over an
 *     indexed membership table) and expensive for a smart one (it
 *     runs the search). `listSpaces()` therefore returns `null` for a
 *     smart count and the UI shows "Auto" until the detail page or a
 *     lazy `?withCounts=1` fetch resolves it.
 *   * membership is never written for a smart Space; a trigger
 *     rejects it (see migration 018 — a CHECK constraint cannot
 *     express it, because "is the parent space manual?" is a
 *     cross-table question).
 *
 * Every statement is scoped by `user_id`. RLS enforces the same rule
 * underneath, but the explicit WHERE clauses keep the dev/demo flow
 * (fixed token, no Supabase auth) honest.
 */

import type { Pool, PoolClient } from 'pg';
import type { SearchRequest } from './search-service.js';

/** The two Space kinds. `smart` replaced the earlier `dynamic` name. */
export type SpaceType = 'manual' | 'smart';

/**
 * Curated identity palette. Closed set, enforced by a CHECK
 * constraint in the DB as well as here, so no client can inject an
 * arbitrary colour. Muted hues only: they read as a 6px dot or a 2px
 * accent on the #15171C surface without fighting it.
 */
export const SPACE_COLORS = [
  'violet',
  'blue',
  'teal',
  'sage',
  'amber',
  'rose',
  'slate'
] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];

export function isSpaceColor(value: unknown): value is SpaceColor {
  return typeof value === 'string' && (SPACE_COLORS as readonly string[]).includes(value);
}

export interface Space {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: SpaceColor | null;
  spaceType: SpaceType;
  coverItemId: string | null;
  /** Only present on a smart Space. A saved SearchRequest. */
  rule: SearchRequest | null;
  ruleVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceItem {
  spaceId: string;
  itemId: string;
  addedAt: Date;
}

/** A lightweight representative memory for a Space card. */
export interface SpacePreviewItem {
  id: string;
  kind: string;
  title: string;
  thumbnailUrl: string | null;
  isFavorite: boolean;
}

export interface SpaceSummary extends Space {
  /**
   * Manual: exact row count. Smart: `null` until resolved, because
   * computing it means running the search. The UI shows "Auto" for
   * null rather than lying with a 0.
   */
  itemCount: number | null;
  previewItems: SpacePreviewItem[];
}

export interface CreateSpaceInput {
  userId: string;
  name: string;
  description?: string | null;
  color?: SpaceColor | null;
  spaceType: SpaceType;
  coverItemId?: string | null;
  rule?: SearchRequest;
}

export interface UpdateSpaceInput {
  name?: string;
  description?: string | null;
  color?: SpaceColor | null;
  coverItemId?: string | null;
  /** Replaces the criteria of a smart Space. Ignored for manual. */
  rule?: SearchRequest;
}

/** How many memories a Space card shows. */
const PREVIEW_SIZE = 4;

export interface SpaceRepository {
  createSpace(input: CreateSpaceInput): Promise<Space>;
  updateSpace(spaceId: string, userId: string, patch: UpdateSpaceInput): Promise<Space | null>;
  deleteSpace(spaceId: string, userId: string): Promise<boolean>;

  /**
   * One round trip. `resolvedCounts` maps space id -> member count for
   * smart Spaces whose count the caller already has (e.g. because it
   * just resolved them); anything absent stays `null`.
   */
  listSpaces(userId: string, resolvedCounts?: Map<string, number>): Promise<SpaceSummary[]>;
  getSpace(spaceId: string, userId: string): Promise<SpaceSummary | null>;

  addItem(spaceId: string, itemId: string, userId: string): Promise<boolean>;
  addItems(spaceId: string, itemIds: string[], userId: string): Promise<{ added: string[]; skipped: string[] }>;
  removeItem(spaceId: string, itemId: string, userId: string): Promise<boolean>;
  listItems(spaceId: string, userId: string, limit?: number, offset?: number): Promise<string[]>;
}

function toSpace(row: Record<string, unknown>): Space {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    color: isSpaceColor(row.color) ? row.color : null,
    spaceType: row.space_type as SpaceType,
    coverItemId: (row.cover_item_id as string | null) ?? null,
    rule: (row.rule as SearchRequest | null) ?? null,
    ruleVersion: Number(row.rule_version ?? 1),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string)
  };
}

/**
 * Assets are stored in a private bucket, so a preview must reference
 * them through the signed-URL endpoint rather than a public path.
 * Returning a null thumbnail makes the card fall back to a type glyph,
 * which is why the repository does not attempt to mint URLs itself —
 * the caller owns the signer.
 */
function toPreviewItem(
  row: Record<string, unknown>,
  thumbnailUrl: string | null
): SpacePreviewItem {
  return {
    id: String(row.id),
    kind: String(row.type ?? 'text'),
    title: String(row.title ?? ''),
    thumbnailUrl,
    isFavorite: Boolean(row.is_favorite)
  };
}

export function createSpaceRepository(pool: Pool): SpaceRepository {
  /**
   * Most recent members of the given spaces, one query for all of
   * them. A per-space subquery would be N+1; the LATERAL join with
   * LIMIT gives the same rows in a single scan of the membership index.
   */
  async function loadPreviews(
    client: Pool | PoolClient,
    userId: string,
    spaceIds: string[]
  ): Promise<Map<string, SpacePreviewItem[]>> {
    const out = new Map<string, SpacePreviewItem[]>();
    if (spaceIds.length === 0) return out;
    const result = await client.query<Record<string, unknown>>(
      `SELECT m.space_id, m.item_id, m.added_at, i.type, i.title, i.is_favorite
       FROM (
         SELECT DISTINCT ON (si.space_id)
                si.space_id, si.item_id, si.added_at
         FROM space_items si
         WHERE si.space_id = ANY($2::uuid[])
         ORDER BY si.space_id, si.added_at DESC, si.item_id
       ) m
       JOIN items i ON i.id = m.item_id AND i.user_id = $1
       ORDER BY m.space_id, m.added_at DESC`,
      [userId, spaceIds]
    );
    for (const row of result.rows) {
      const spaceId = String(row.space_id);
      const list = out.get(spaceId) ?? [];
      if (list.length < PREVIEW_SIZE) {
        list.push(toPreviewItem(row, null));
        out.set(spaceId, list);
      }
    }
    return out;
  }

  return {
    async createSpace(input) {
      // A smart Space is meaningless without criteria, and a manual
      // Space with criteria would silently ignore them. Reject both
      // mismatches here so no half-formed row can exist.
      if (input.spaceType === 'smart' && !input.rule) {
        throw new Error('A smart Space requires a rule');
      }
      if (input.spaceType === 'manual' && input.rule) {
        throw new Error('A manual Space cannot have a rule');
      }

      const result = await pool.query<Record<string, unknown>>(
        `INSERT INTO spaces
           (user_id, name, description, color, space_type, cover_item_id, rule, rule_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         RETURNING *`,
        [
          input.userId,
          input.name,
          input.description ?? null,
          input.color ?? null,
          input.spaceType,
          input.coverItemId ?? null,
          input.rule ? JSON.stringify(input.rule) : null
        ]
      );
      return toSpace(result.rows[0]);
    },

    async updateSpace(spaceId, userId, patch) {
      const sets: string[] = [];
      const values: unknown[] = [];

      const push = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };

      if (patch.name !== undefined) push('name', patch.name);
      if (patch.description !== undefined) push('description', patch.description);
      if (patch.color !== undefined) push('color', patch.color);
      if (patch.coverItemId !== undefined) push('cover_item_id', patch.coverItemId);

      // The rule may only change on a smart Space. Reading the row
      // first also lets us skip the UPDATE entirely when there is
      // nothing to change, which keeps `updated_at` honest.
      if (patch.rule !== undefined) {
        const current = await pool.query<{ space_type: string }>(
          `SELECT space_type FROM spaces WHERE id = $1 AND user_id = $2`,
          [spaceId, userId]
        );
        if (!current.rows[0]) return null;
        if (current.rows[0].space_type !== 'smart') {
          throw new Error('Cannot set a rule on a manual Space');
        }
        push('rule', JSON.stringify(patch.rule));
        // Bump the version so a future migration can tell which
        // documents predate a SearchRequest change.
        sets.push('rule_version = rule_version + 1');
      }

      if (sets.length === 0) {
        const existing = await pool.query<Record<string, unknown>>(
          `SELECT * FROM spaces WHERE id = $1 AND user_id = $2`,
          [spaceId, userId]
        );
        return existing.rows[0] ? toSpace(existing.rows[0]) : null;
      }

      values.push(spaceId, userId);
      const result = await pool.query<Record<string, unknown>>(
        `UPDATE spaces SET ${sets.join(', ')}
         WHERE id = $${values.length - 1} AND user_id = $${values.length}
         RETURNING *`,
        values
      );
      return result.rows[0] ? toSpace(result.rows[0]) : null;
    },

    async deleteSpace(spaceId, userId) {
      // Membership rows go with it via ON DELETE CASCADE. Items do
      // NOT: the user loses the grouping, not the memories.
      const result = await pool.query(
        `DELETE FROM spaces WHERE id = $1 AND user_id = $2`,
        [spaceId, userId]
      );
      return (result.rowCount ?? 0) > 0;
    },

    async listSpaces(userId, resolvedCounts) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT s.*,
                CASE WHEN s.space_type = 'manual'
                  THEN (SELECT COUNT(*)::int FROM space_items si WHERE si.space_id = s.id)
                  ELSE NULL
                END AS item_count
         FROM spaces s
         WHERE s.user_id = $1
         ORDER BY s.updated_at DESC`,
        [userId]
      );

      const summaries: SpaceSummary[] = result.rows.map((row) => {
        const space = toSpace(row);
        const resolved = resolvedCounts?.get(space.id);
        return {
          ...space,
          itemCount:
            space.spaceType === 'manual' ? Number(row.item_count ?? 0) : resolved ?? null,
          previewItems: []
        };
      });

      // Manual previews come straight from the membership table. A
      // smart Space's preview is its current match set, which the
      // caller resolves through search; until then it shows no tiles
      // rather than a stale snapshot.
      const manualIds = summaries.filter((s) => s.spaceType === 'manual').map((s) => s.id);
      const previews = await loadPreviews(pool, userId, manualIds);
      for (const summary of summaries) {
        summary.previewItems = previews.get(summary.id) ?? [];
      }
      return summaries;
    },

    async getSpace(spaceId, userId) {
      const result = await pool.query<Record<string, unknown>>(
        `SELECT s.*,
                CASE WHEN s.space_type = 'manual'
                  THEN (SELECT COUNT(*)::int FROM space_items si WHERE si.space_id = s.id)
                  ELSE NULL
                END AS item_count
         FROM spaces s
         WHERE s.id = $1 AND s.user_id = $2`,
        [spaceId, userId]
      );
      if (!result.rows[0]) return null;
      const space = toSpace(result.rows[0]);
      const previewMap = await loadPreviews(pool, userId, [space.id]);
      return {
        ...space,
        itemCount: space.spaceType === 'manual' ? Number(result.rows[0].item_count ?? 0) : null,
        previewItems: previewMap.get(space.id) ?? []
      };
    },

    async addItem(spaceId, itemId, userId) {
      const result = await pool.query<{ space_type: string }>(
        `SELECT space_type FROM spaces WHERE id = $1 AND user_id = $2`,
        [spaceId, userId]
      );
      const space = result.rows[0];
      if (!space) return false;
      if (space.space_type !== 'manual') return false;

      // ON CONFLICT DO NOTHING makes a repeat add a no-op rather than
      // an error, so the endpoint is idempotent by construction.
      const inserted = await pool.query(
        `INSERT INTO space_items (space_id, item_id)
         SELECT $1, $2
         WHERE EXISTS (SELECT 1 FROM items i WHERE i.id = $2 AND i.user_id = $3)
         ON CONFLICT (space_id, item_id) DO NOTHING`,
        [spaceId, itemId, userId]
      );
      return (inserted.rowCount ?? 0) > 0;
    },

    async addItems(spaceId, itemIds, userId) {
      const result = await pool.query<{ space_type: string }>(
        `SELECT space_type FROM spaces WHERE id = $1 AND user_id = $2`,
        [spaceId, userId]
      );
      const space = result.rows[0];
      if (!space) throw new Error('SPACE_NOT_FOUND');
      if (space.space_type !== 'manual') throw new Error('SPACE_NOT_MANUAL');

      // De-duplicate up front so the counts below are meaningful and a
      // repeated id in one request cannot double-count.
      const unique = Array.from(new Set(itemIds));
      if (unique.length === 0) return { added: [], skipped: [] };

      // One statement: only ids the caller actually owns are
      // inserted, and the SELECT reports which ones were new.
      const inserted = await pool.query<{ item_id: string }>(
        `INSERT INTO space_items (space_id, item_id)
         SELECT $1, i.id
         FROM items i
         WHERE i.id = ANY($2::uuid[]) AND i.user_id = $3
         ON CONFLICT (space_id, item_id) DO NOTHING
         RETURNING item_id`,
        [spaceId, unique, userId]
      );
      const added = inserted.rows.map((r) => String(r.item_id));
      const addedSet = new Set(added);
      // Anything not returned was either already a member or not ours.
      const skipped = unique.filter((id) => !addedSet.has(id));
      return { added, skipped };
    },

    async removeItem(spaceId, itemId, userId) {
      const result = await pool.query(
        `DELETE FROM space_items si
         USING spaces s
         WHERE si.space_id = $1
           AND si.item_id = $2
           AND s.id = si.space_id
           AND s.user_id = $3`,
        [spaceId, itemId, userId]
      );
      return (result.rowCount ?? 0) > 0;
    },

    async listItems(spaceId, userId, limit = 100, offset = 0) {
      const result = await pool.query<{ id: string }>(
        `SELECT i.id
         FROM space_items si
         JOIN items i ON i.id = si.item_id
         WHERE si.space_id = $1 AND i.user_id = $2
         ORDER BY si.added_at DESC, si.item_id
         LIMIT $3 OFFSET $4`,
        [spaceId, userId, limit, offset]
      );
      return result.rows.map((row) => String(row.id));
    }
  };
}
