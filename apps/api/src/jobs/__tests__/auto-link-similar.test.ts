/**
 * Auto-link safety tests.
 *
 * Locks in the four invariants introduced by Milestone 1 of the AI
 * Quality upgrade (see migration 022_embedding_identity.sql):
 *
 *  1. The edge `attributes.model` field is the LIVE provider model,
 *     never a hard-coded label. A test that stubs the embedding
 *     info with a custom model string must observe that string on
 *     the persisted row.
 *  2. Cross-model similarity is silently skipped. Two rows whose
 *     `model` strings differ must not be linked, even if their
 *     dimensions match.
 *  3. A `legacy` or `noop` source row produces zero edges.
 *  4. The edge carries `embedding_identity` and `algorithm_version`
 *     so downstream code can filter by identity without parsing
 *     JSON.
 *
 * The test uses an in-memory SQL stub that satisfies the surface
 * the function uses (parameterised SELECT, INSERT, ON CONFLICT).
 * The full Postgres operator `<=>` is not required: the stub
 * returns a pre-canned neighbour so the test can drive the
 * cross-model branch deterministically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { autoLinkSimilarItems } from '../auto-link-similar.js';

interface PoolRow {
  [column: string]: unknown;
}

class StubPool {
  /** Next-call queue: the i-th .query() pulls rows/result from here. */
  responses: Array<{ rows: PoolRow[]; rowCount?: number }> = [];
  calls: Array<{ sql: string; params: unknown[] }> = [];
  /** Recorded writes (for the edge INSERT path). */
  inserts: Array<{ sql: string; params: unknown[] }> = [];

  async query<T extends PoolRow = PoolRow>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    const upper = sql.trim().toUpperCase();
    this.calls.push({ sql, params });
    if (upper.startsWith('INSERT')) {
      this.inserts.push({ sql, params });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (this.responses.length === 0) {
      return { rows: [] as T[], rowCount: 0 };
    }
    const next = this.responses.shift()!;
    return { rows: next.rows as T[], rowCount: next.rowCount ?? next.rows.length };
  }
}

function makeSourceRow(overrides: Partial<PoolRow> = {}): PoolRow {
  return {
    model: 'gemini/gemini-embedding-001',
    dimensions: 1024,
    embedding_version: 'gemini-001-20261008',
    embedding_kind: 'real',
    user_id: '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

describe('autoLinkSimilarItems', () => {
  let pool: StubPool;
  const USER_ID = '00000000-0000-4000-8000-000000000001';
  const ITEM_ID = '00000000-0000-4000-8000-000000000010';

  beforeEach(() => {
    pool = new StubPool();
  });

  it('returns no neighbours when the source row is missing', async () => {
    pool.responses = [{ rows: [] }];
    const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(result).toEqual([]);
  });

  it('refuses to link when the source row is `legacy`', async () => {
    pool.responses = [{ rows: [makeSourceRow({ embedding_kind: 'legacy' })] }];
    const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(result).toEqual([]);
    // The function must short-circuit BEFORE the candidate SELECT,
    // so no second call should be issued.
    expect(pool.calls.length).toBe(1);
  });

  it('refuses to link when the source row is `noop`', async () => {
    pool.responses = [{ rows: [makeSourceRow({ embedding_kind: 'noop' })] }];
    const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(result).toEqual([]);
  });

  it('refuses to link when the source row belongs to a different user', async () => {
    pool.responses = [
      { rows: [makeSourceRow({ user_id: '00000000-0000-4000-8000-000000000099' })] },
    ];
    const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(result).toEqual([]);
  });

  it('persists edges with the actual provider model, not a hard-coded string', async () => {
    // 1st call: source identity
    // 2nd call: candidate neighbours
    pool.responses = [
      { rows: [makeSourceRow({ model: 'ollama/bge-m3' })] },
      { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 0.91 }] },
    ];
    const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(result).toHaveLength(1);
    expect(result[0].embeddingModel).toBe('ollama/bge-m3');

    // One edge upsert per neighbour; the SQL writes both directions
    // in a single statement (one VALUES row per direction). So
    // there is exactly one INSERT call per neighbour, and the
    // captured params are the first direction only.
    const inserts = pool.inserts;
    expect(inserts).toHaveLength(1);
    const ins = inserts[0];
    // ($1=userId, $2=from, $3=to, $4=weight, $5=jsonb, $6=model,
    //  $7=algoVersion, $8=identity)
    expect(ins.params[5]).toBe('ollama/bge-m3');
    const identity = ins.params[7] as string;
    expect(identity).toBe('ollama/bge-m3|1024|gemini-001-20261008');
    const json = JSON.parse(ins.params[4] as string);
    expect(json.model).toBe('ollama/bge-m3');
    // The hard-coded OpenAI label must NEVER appear in the new
    // attributes payload. If it does, the regression is back.
    expect(json.model).not.toContain('text-embedding-3');
    // The SQL must write both directions in one statement (the
    // single-row VALUES clause in the production code duplicates
    // the row with swapped from/to item ids).
    expect(ins.sql).toMatch(/VALUES\s*\(\s*\$1,\s*\$2,\s*\$3/i);
    expect(ins.sql).toContain('$1, $3, $2');
  });

  it('passes identity filters into the candidate SELECT', async () => {
    pool.responses = [
      { rows: [makeSourceRow()] },
      { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 0.85 }] },
    ];
    await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);

    // The candidate SELECT is the 2nd call. Inspect the SQL.
    const candidate = pool.calls[1];
    const sql = candidate.sql;
    // Identity guards: model/dimensions/version must appear AND the
    // legacy kind must be excluded.
    expect(sql).toMatch(/target\.model\s*=\s*source\.model/);
    expect(sql).toMatch(/target\.dimensions\s*=\s*source\.dimensions/);
    expect(sql).toMatch(/target\.embedding_version\s*=\s*source\.embedding_version/);
    expect(sql).toMatch(/target\.embedding_kind\s*=\s*'real'/);
    expect(sql).toMatch(/source\.embedding_kind\s*=\s*'real'/);
  });

  it('upserts edges on conflict (idempotent re-runs)', async () => {
    pool.responses = [
      { rows: [makeSourceRow()] },
      { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 0.88 }] },
    ];
    await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
    expect(pool.inserts[0].sql).toMatch(/ON CONFLICT \(user_id, from_item_id, to_item_id, edge_type\)/);
    expect(pool.inserts[0].sql).toMatch(/DO UPDATE SET/);
  });

  // M7 — explainability at the auto-link boundary.
  describe('M7 explainability', () => {
    it('omits the explanation field when SEARCH_EXPLAINABILITY_ENABLED is unset', async () => {
      delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
      pool.responses = [
        { rows: [makeSourceRow()] },
        { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 0.85 }] }
      ];
      const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
      expect(result[0].explanation).toBeUndefined();
    });

    it('attaches explanation.weight when SEARCH_EXPLAINABILITY_ENABLED=true', async () => {
      process.env.SEARCH_EXPLAINABILITY_ENABLED = 'true';
      try {
        pool.responses = [
          { rows: [makeSourceRow()] },
          { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 0.85 }] }
        ];
        const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
        expect(result[0].explanation).toEqual({ weight: 0.85 });
      } finally {
        delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
      }
    });

    it('clamps the explanation weight into [0, 1]', async () => {
      process.env.SEARCH_EXPLAINABILITY_ENABLED = 'true';
      try {
        pool.responses = [
          { rows: [makeSourceRow()] },
          { rows: [{ id: '00000000-0000-4000-8000-000000000020', similarity: 1.4 }] }
        ];
        const result = await autoLinkSimilarItems(pool as unknown as never, USER_ID, ITEM_ID);
        expect(result[0].explanation).toEqual({ weight: 1 });
      } finally {
        delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
      }
    });
  });
});
