import { describe, expect, it } from 'vitest';
import { JobQueue } from '../queue.js';
import { TagHandler } from '../handlers/tag.js';
import { EmbedHandler } from '../handlers/embed.js';

function createNoopAi() {
  return {
    text: { info: () => ({ name: 'noop', model: 'noop' }), generateTags: async () => [], summarize: async () => '' },
    embeddings: { info: () => ({ name: 'noop', model: 'noop', dimensions: 0 }), embedOne: async () => [], embedMany: async () => [[]] },
    primaryOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    fallbackOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    visual: { info: () => ({ name: 'noop', model: 'noop' }) },
    recognizeWithFallback: async () => ({ text: '', engine: 'noop', confidence: 0 }),
    tagCache: { get: () => undefined, set: () => undefined },
    summaryCache: { get: () => undefined, set: () => undefined },
    embeddingCache: { get: () => undefined, set: () => undefined },
    ocrCache: { get: () => undefined, set: () => undefined },
    health: async () => ({
      config: { freeOnly: true, demoMode: true, text: 'noop', embeddings: 'noop', ocr: 'noop', visual: 'noop' },
      textReady: false, embeddingsReady: false, ocrReady: false, visualReady: false, notes: []
    }),
    config: {} as any
  } as any;
}

function createMockAi(vec: number[]) {
  const ai = createNoopAi();
  ai.embeddings = {
    info: () => ({ name: 'mock', model: 'mock-1536', dimensions: 3 }),
    embedOne: async () => vec,
    embedMany: async () => [vec]
  };
  return ai;
}

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '00000000-0000-4000-8000-000000000010';

function createPipelinePool() {
  const jobs: any[] = [];
  const now = () => new Date().toISOString();

  return {
    jobs,
    query: async (sql: string, params: any[]) => {
      if (sql.includes('INSERT INTO jobs')) {
        const type = params[1];
        const itemId = params[2];
        const userId = params[3];
        const active = jobs.find(
          job => job.item_id === itemId &&
            job.type === type &&
            (job.status === 'pending' || job.status === 'processing')
        );

        if (active) {
          return { rows: [], rowCount: 0 };
        }

        const job = {
          id: params[0],
          type,
          item_id: itemId,
          user_id: userId,
          payload: params[4],
          status: 'pending',
          attempts: 0,
          max_attempts: params[5],
          error: null,
          created_at: now(),
          updated_at: now(),
          completed_at: null
        };
        jobs.push(job);
        return { rows: [job], rowCount: 1 };
      }

      if (sql.includes('SELECT * FROM jobs') && sql.includes('status = \'pending\'')) {
        const limit = Number(params[0]);
        return { rows: jobs.filter(job => job.status === 'pending' && job.attempts < job.max_attempts).slice(0, limit), rowCount: 1 };
      }

      if (sql.includes('SET status = \'processing\'')) {
        const job = jobs.find(row => row.id === params[0] && row.status === 'pending');
        if (!job) return { rows: [], rowCount: 0 };
        job.status = 'processing';
        job.attempts += 1;
        job.updated_at = now();
        return { rows: [job], rowCount: 1 };
      }

      if (sql.includes('SET status = \'completed\'')) {
        const job = jobs.find(row => row.id === params[0]);
        if (!job) return { rows: [], rowCount: 0 };
        job.status = 'completed';
        job.completed_at = now();
        job.updated_at = now();
        return { rows: [job], rowCount: 1 };
      }

      if (sql.includes('SELECT COUNT(*) AS total')) {
        const itemJobs = jobs.filter(job => job.item_id === params[0]);
        return {
          rows: [{
            total: String(itemJobs.length),
            completed: String(itemJobs.filter(job => job.status === 'completed').length)
          }],
          rowCount: 1
        };
      }

      if (sql.includes('SELECT * FROM jobs') && sql.includes('status IN (\'pending\', \'processing\')')) {
        const active = jobs.find(
          job => job.item_id === params[0] &&
            job.type === params[1] &&
            (job.status === 'pending' || job.status === 'processing')
        );
        return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    }
  } as any;
}

describe('capture processing pipeline', () => {
  it('moves a text item from tag processing to embedded ready', async () => {
    const pool = createPipelinePool();
    const queue = new JobQueue(pool);
    const item = {
      id: ITEM_ID,
      userId: USER_ID,
      type: 'text',
      title: 'Retry idempotency guide',
      rawText: 'Use idempotency keys when retrying network requests.'
    };
    const statuses: string[] = [];
    let embeddingsSaved = 0;
    const repository = {
      findById: async () => item,
      updateStatus: async (_itemId: string, status: string) => {
        statuses.push(status);
      },
      updateTags: async () => undefined,
      getTagsForItem: async () => [],
      saveEmbedding: async () => {
        embeddingsSaved += 1;
      }
    } as any;

    const tagHandler = new TagHandler({ queue, repository, ai: createNoopAi() });
    const embedHandler = new EmbedHandler({
      queue,
      repository,
      ai: createMockAi([0, 1, 0]),
    });

    queue.registerHandler('tag', job => tagHandler.handle(job));
    queue.registerHandler('embed', job => embedHandler.handle(job));

    await queue.create({ type: 'tag', itemId: ITEM_ID, userId: USER_ID });
    await queue.processOnce();

    expect(pool.jobs.map(job => [job.type, job.status])).toEqual([
      ['tag', 'completed'],
      ['embed', 'pending']
    ]);
    expect(statuses).toEqual(['processing']);

    await queue.processOnce();

    expect(pool.jobs.every(job => job.status === 'completed')).toBe(true);
    expect(statuses).toEqual(['processing', 'ready']);
    expect(embeddingsSaved).toBe(1);
    queue.stop();
  });
});
