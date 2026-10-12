/**
 * Spaces repository + Smart Space behaviour.
 *
 * Runs against the real Postgres the demo environment provides, so
 * the constraints added in migration 018 (smart/manual rule shape,
 * colour enum, manual-only membership) are exercised for real rather
 * than mocked away.
 *
 * The headline test is the last describe block: it proves a Smart
 * Space is dynamic. Nothing writes to the Space between the two reads
 * — a matching memory is simply created, and the Space picks it up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPool,
  createSpaceRepository,
  resolveSmartSpaceIds,
  runSearch,
  type SpaceRepository
} from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

let pool: Pool;
let spaces: SpaceRepository;
let userId: string;
let otherUserId: string;
let itemIds: string[];

/**
 * Create a throwaway auth user.
 *
 * Only the two columns the repo actually provisions are written.
 * `demo-setup.mts` and the CI bootstrap both create `auth.users`
 * with `(id, raw_user_meta_data)` alone — inserting the full
 * Supabase shape (instance_id, role, aud, ...) works against a real
 * hosted project and fails against either of those, so the test
 * suite carries an email in metadata instead.
 */
async function createUser(email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(res.rows[0].id);
}

async function createItem(
  owner: string,
  overrides: { title?: string; type?: string; rawText?: string; status?: string } = {}
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, title, raw_text, captured_at, status, client_request_id)
     VALUES ($1, $2, $3, $4, NOW(), $5, gen_random_uuid())
     RETURNING id`,
    [
      owner,
      overrides.type ?? 'text',
      overrides.title ?? 'Item',
      overrides.rawText ?? '',
      overrides.status ?? 'ready'
    ]
  );
  return String(res.rows[0].id);
}

beforeEach(async () => {
  pool = createPool(DATABASE_URL);
  spaces = createSpaceRepository(pool);
  userId = await createUser(`spaces-${Date.now()}-${Math.random()}@example.com`);
  otherUserId = await createUser(`other-${Date.now()}-${Math.random()}@example.com`);
  itemIds = [await createItem(userId, { title: 'A' }), await createItem(userId, { title: 'B' })];
});

afterEach(async () => {
  await pool.query(`DELETE FROM spaces WHERE user_id = ANY($1::uuid[])`, [[userId, otherUserId]]);
  await pool.query(`DELETE FROM items WHERE user_id = ANY($1::uuid[])`, [[userId, otherUserId]]);
  await pool.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[userId, otherUserId]]);
  await pool.end();
});

describe('manual spaces', () => {
  it('creates a manual space owned by the caller', async () => {
    const space = await spaces.createSpace({ userId, name: 'M&A Research', spaceType: 'manual' });
    expect(space.id).toBeTruthy();
    expect(space.userId).toBe(userId);
    expect(space.spaceType).toBe('manual');
    expect(space.rule).toBeNull();
  });

  it('stores the curated colour', async () => {
    const space = await spaces.createSpace({
      userId, name: 'Coloured', spaceType: 'manual', color: 'teal'
    });
    expect(space.color).toBe('teal');
  });

  it('rejects a colour outside the curated palette at the database level', async () => {
    await expect(
      spaces.createSpace({
        userId, name: 'Neon', spaceType: 'manual', color: '#ff00ff' as never
      })
    ).rejects.toThrow();
  });

  it('renames and recolours', async () => {
    const space = await spaces.createSpace({ userId, name: 'Before', spaceType: 'manual' });
    const updated = await spaces.updateSpace(space.id, userId, { name: 'After', color: 'rose' });
    expect(updated?.name).toBe('After');
    expect(updated?.color).toBe('rose');
  });

  it('adds one item, and a repeat add is idempotent', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    expect(await spaces.addItem(space.id, itemIds[0], userId)).toBe(true);
    // Second call must not throw and must not duplicate the row.
    expect(await spaces.addItem(space.id, itemIds[0], userId)).toBe(false);
    expect(await spaces.listItems(space.id, userId)).toEqual([itemIds[0]]);
  });

  it('adds many items in one call and reports what was skipped', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    await spaces.addItem(space.id, itemIds[0], userId);
    const foreign = await createItem(otherUserId, { title: 'not yours' });

    const result = await spaces.addItems(space.id, [...itemIds, foreign], userId);
    // Only itemIds[1] was genuinely new.
    expect(result.added).toEqual([itemIds[1]]);
    // itemIds[0] was already a member; `foreign` is not ours.
    expect(result.skipped.sort()).toEqual([itemIds[0], foreign].sort());
    expect(await spaces.listItems(space.id, userId)).toHaveLength(2);
  });

  it('de-duplicates repeated ids inside a single request', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    const result = await spaces.addItems(space.id, [itemIds[0], itemIds[0], itemIds[0]], userId);
    expect(result.added).toEqual([itemIds[0]]);
    expect(result.skipped).toEqual([]);
    expect(await spaces.listItems(space.id, userId)).toEqual([itemIds[0]]);
  });

  it('removes membership without touching the memory', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    await spaces.addItem(space.id, itemIds[0], userId);
    expect(await spaces.removeItem(space.id, itemIds[0], userId)).toBe(true);
    expect(await spaces.listItems(space.id, userId)).toEqual([]);

    const stillThere = await pool.query('SELECT 1 FROM items WHERE id = $1', [itemIds[0]]);
    expect(stillThere.rowCount).toBe(1);
  });

  it('drops membership automatically when the memory is deleted', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    await spaces.addItem(space.id, itemIds[0], userId);
    await pool.query('DELETE FROM items WHERE id = $1', [itemIds[0]]);
    // No orphan row may remain; the FK cascade has to have run.
    const orphans = await pool.query('SELECT 1 FROM space_items WHERE space_id = $1', [space.id]);
    expect(orphans.rowCount).toBe(0);
  });

  it('deleting a space preserves the memories', async () => {
    const space = await spaces.createSpace({ userId, name: 'Doomed', spaceType: 'manual' });
    await spaces.addItem(space.id, itemIds[0], userId);
    expect(await spaces.deleteSpace(space.id, userId)).toBe(true);

    const survivors = await pool.query('SELECT 1 FROM items WHERE user_id = $1', [userId]);
    expect(survivors.rowCount).toBe(2);
    const memberships = await pool.query('SELECT 1 FROM space_items WHERE space_id = $1', [space.id]);
    expect(memberships.rowCount).toBe(0);
  });
});

describe('ownership isolation', () => {
  it('never lists another user\'s spaces', async () => {
    await spaces.createSpace({ userId, name: 'Mine', spaceType: 'manual' });
    await spaces.createSpace({ userId: otherUserId, name: 'Theirs', spaceType: 'manual' });
    const mine = await spaces.listSpaces(userId);
    expect(mine.map((s) => s.name)).toEqual(['Mine']);
  });

  it('cannot read, update, or delete a foreign space', async () => {
    const theirs = await spaces.createSpace({ userId: otherUserId, name: 'Theirs', spaceType: 'manual' });
    expect(await spaces.getSpace(theirs.id, userId)).toBeNull();
    expect(await spaces.updateSpace(theirs.id, userId, { name: 'hijacked' })).toBeNull();
    expect(await spaces.deleteSpace(theirs.id, userId)).toBe(false);
  });

  it('cannot add a foreign memory to a space', async () => {
    const mine = await spaces.createSpace({ userId, name: 'Mine', spaceType: 'manual' });
    const foreign = await createItem(otherUserId, { title: 'theirs' });
    expect(await spaces.addItem(mine.id, foreign, userId)).toBe(false);
    expect(await spaces.listItems(mine.id, userId)).toEqual([]);
  });

  it('cannot add my memory to a foreign space', async () => {
    const theirs = await spaces.createSpace({ userId: otherUserId, name: 'Theirs', spaceType: 'manual' });
    expect(await spaces.addItem(theirs.id, itemIds[0], userId)).toBe(false);
  });
});

describe('smart spaces', () => {
  it('stores criteria, not result ids', async () => {
    const space = await spaces.createSpace({
      userId,
      name: 'Logo Inspiration',
      spaceType: 'smart',
      color: 'blue',
      rule: { q: 'logo', filters: { kind: ['image'], tags: ['design'] } }
    });
    expect(space.rule).toEqual({ q: 'logo', filters: { kind: ['image'], tags: ['design'] } });
    expect(space.ruleVersion).toBe(1);

    // A smart Space must hold no membership rows at all.
    const rows = await pool.query('SELECT 1 FROM space_items WHERE space_id = $1', [space.id]);
    expect(rows.rowCount).toBe(0);
  });

  it('rejects a manual space that carries a rule', async () => {
    await expect(
      spaces.createSpace({ userId, name: 'X', spaceType: 'manual', rule: { q: 'a' } })
    ).rejects.toThrow(/manual Space cannot have a rule/);
  });

  it('rejects a smart space with no rule', async () => {
    await expect(
      spaces.createSpace({ userId, name: 'X', spaceType: 'smart' })
    ).rejects.toThrow(/smart Space requires a rule/);
  });

  it('edits its criteria, bumping the rule version', async () => {
    const space = await spaces.createSpace({
      userId, name: 'S', spaceType: 'smart', rule: { q: 'old' }
    });
    const updated = await spaces.updateSpace(space.id, userId, { rule: { q: 'new' } });
    expect(updated?.rule).toEqual({ q: 'new' });
    expect(updated?.ruleVersion).toBe(2);
  });

  it('refuses a rule change on a manual space', async () => {
    const space = await spaces.createSpace({ userId, name: 'S', spaceType: 'manual' });
    await expect(
      spaces.updateSpace(space.id, userId, { rule: { q: 'nope' } })
    ).rejects.toThrow(/manual Space/);
  });

  it('rejects manual membership changes with a typed error', async () => {
    const space = await spaces.createSpace({
      userId, name: 'S', spaceType: 'smart', rule: { q: 'x' }
    });
    await expect(spaces.addItems(space.id, [itemIds[0]], userId)).rejects.toThrow(
      'SPACE_NOT_MANUAL'
    );
    expect(await spaces.addItem(space.id, itemIds[0], userId)).toBe(false);
  });

  it('deleting a smart space clears the stored rule', async () => {
    const space = await spaces.createSpace({
      userId, name: 'S', spaceType: 'smart', rule: { q: 'x' }
    });
    expect(await spaces.deleteSpace(space.id, userId)).toBe(true);
    expect(await spaces.getSpace(space.id, userId)).toBeNull();
  });
});

/**
 * The behaviour the whole Smart Space concept exists for: membership
 * is derived, never stored, so a new matching memory appears with no
 * write to the Space.
 */
describe('smart spaces are dynamic', () => {
  it('picks up a matching memory created after the space', async () => {
    const matching = await createItem(userId, {
      title: 'Logo design inspiration',
      rawText: 'a logo for the brand'
    });
    const nonMatching = await createItem(userId, {
      title: 'Tax filing notes',
      rawText: 'quarterly numbers'
    });

    const space = await spaces.createSpace({
      userId,
      name: 'Logo Inspiration',
      spaceType: 'smart',
      rule: { q: 'logo' }
    });
    const deps = { pool };

    const first = await resolveSmartSpaceIds(deps, userId, space.rule!);
    expect(first.ids).toContain(matching);
    expect(first.ids).not.toContain(nonMatching);

    // A new memory arrives. Nothing touches the Space.
    const later = await createItem(userId, {
      title: 'Another logo sketch',
      rawText: 'more logo work'
    });

    const second = await resolveSmartSpaceIds(deps, userId, space.rule!);
    expect(second.ids).toContain(matching);
    expect(second.ids).toContain(later);
    expect(second.total).toBe(first.total + 1);

    // The row itself is untouched, which is the point.
    const stored = await spaces.getSpace(space.id, userId);
    expect(stored?.rule).toEqual({ q: 'logo' });
  });

  it('honours a type filter the same way search does', async () => {
    const img = await createItem(userId, { title: 'logo', type: 'image' });
    const txt = await createItem(userId, { title: 'logo', type: 'text' });
    const rule = { q: 'logo', filters: { kind: ['image' as const] } };
    const { ids } = await resolveSmartSpaceIds({ pool }, userId, rule);
    expect(ids).toContain(img);
    expect(ids).not.toContain(txt);
  });

  it('matches the search service for identical criteria', async () => {
    await createItem(userId, { title: 'logo grid', rawText: 'modular mark' });
    await createItem(userId, { title: 'unrelated', rawText: 'cooking recipe' });
    const rule = { q: 'logo' };
    const viaSpace = await resolveSmartSpaceIds({ pool }, userId, rule);
    const viaSearch = await runSearch({ pool }, userId, { q: 'logo', limit: 100 });
    expect(new Set(viaSpace.ids)).toEqual(new Set(viaSearch.hits.map((h) => h.id)));
  });
});
