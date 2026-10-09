/**
 * M8 — re_embed_user count contract.
 *
 * The function is a count-only SQL function: given a user
 * and a target model, it returns the number of items
 * whose `embedding_model` differs from the target. The
 * function does NOT write to `jobs`; the orchestration
 * step (out of scope for M8) does the writes.
 */
import { describe, expect, it } from 'vitest';
import { reEmbedUserCount } from '../re-embed-user.js';

class StubPool {
  queries: Array<{ sql: string; params: unknown[] }> = [];
  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    return { rows: [{ count: 7 }], rowCount: 1 };
  }
}

describe('re_embed_user — M8 count contract', () => {
  it('returns the count from the function', async () => {
    const pool = new StubPool();
    const count = await reEmbedUserCount(
      pool as unknown as never,
      '00000000-0000-4000-8000-000000000001',
      'gemini-embedding-001'
    );
    expect(count).toBe(7);
  });

  it('passes (user_id, target_model) as parameters in that order', async () => {
    const pool = new StubPool();
    await reEmbedUserCount(
      pool as unknown as never,
      '00000000-0000-4000-8000-000000000001',
      'gemini-embedding-001'
    );
    expect(pool.queries[0].params[0]).toBe('00000000-0000-4000-8000-000000000001');
    expect(pool.queries[0].params[1]).toBe('gemini-embedding-001');
  });

  it('the SQL calls the function, not a free-form SELECT', async () => {
    const pool = new StubPool();
    await reEmbedUserCount(
      pool as unknown as never,
      '00000000-0000-4000-8000-000000000001',
      'gemini-embedding-001'
    );
    expect(pool.queries[0].sql).toMatch(/SELECT\s+re_embed_user\s*\(/i);
  });

  it('handles a string count from the pool (pg numeric type)', async () => {
    class StringCountPool {
      async query() {
        return { rows: [{ count: '12' }], rowCount: 1 };
      }
    }
    const count = await reEmbedUserCount(
      new StringCountPool() as unknown as never,
      '00000000-0000-4000-8000-000000000001',
      'gemini-embedding-001'
    );
    expect(count).toBe(12);
  });
});
