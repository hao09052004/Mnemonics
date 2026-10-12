/**
 * Smoke probe: confirm that the vector leg of the 4-leg hybrid
 * search actually runs against the live DB. We re-use whatever
 * items + embeddings already exist (no setup, no cleanup) and
 * just run `runSearch` with a semantically loaded query.
 *
 * Run: cd apps/api && npx tsx scripts/probe-vector-leg.mts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { createPool, runSearch } from '@mnemonics/database';
import { createAiService } from '@mnemonics/ai';

const p = createPool(process.env.DATABASE_URL ?? '', { family: 4 });
const ai = await createAiService();
console.log(`embeddings: ${ai.embeddings.info().name}:${ai.embeddings.info().model} (${ai.embeddings.info().dimensions}-d)`);

try {
  // Pick a user that already has at least one ready item +
  // a real embedding in item_embeddings.
  const u = await p.query<{ id: string; title: string }>(
    `SELECT i.user_id AS id, i.title
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE i.status = 'ready'
        AND ie.embedding_kind = 'real'
      ORDER BY i.captured_at DESC
      LIMIT 1`
  );
  if (!u.rowCount) {
    console.log('no user with a real embedding — nothing to probe');
    process.exit(0);
  }
  const userId = u.rows[0].id;
  const title = u.rows[0].title;
  console.log(`probe user: ${userId}`);
  console.log(`probe item: "${title.slice(0, 60)}"`);

  // Run a search whose query is *semantically related* to the
  // existing item title (no shared tokens) — this is the only
  // way to expose whether the vector leg actually fires.
  const result = await runSearch(
    { pool: p, embeddings: ai.embeddings },
    userId,
    {
      q: 'mô hình phân lớp dùng hàm sigmoid',
      filters: {},
      limit: 5,
      offset: 0
    }
  );
  console.log(`\nresults: total=${result.total}`);
  console.log(`explain: lex=${result.explain.lexResults} sem=${result.explain.semResults} chunk=${result.explain.chunkResults} struct=${result.explain.structResults ?? 0}`);
  console.log(`weights:`, result.explain.weights);
  for (const h of result.hits) {
    console.log(`  - ${h.id.slice(0, 8)} score=${h.score.toFixed(4)} title="${h.title.slice(0, 60)}"`);
  }

  // Probe with a query semantically close to the existing item.
  const result2 = await runSearch(
    { pool: p, embeddings: ai.embeddings },
    userId,
    {
      q: title.slice(0, 30),
      filters: {},
      limit: 3,
      offset: 0
    }
  );
  console.log(`\nlexical-trim probe: total=${result2.total} lex=${result2.explain.lexResults} sem=${result2.explain.semResults}`);
  for (const h of result2.hits) {
    console.log(`  - ${h.id.slice(0, 8)} score=${h.score.toFixed(4)} title="${h.title.slice(0, 60)}"`);
  }

  // Force a vector-only match: query = exact text that the
  // item was embedded with, run the same embedding, and ask
  // pgvector for the closest neighbour directly.
  const cv = await ai.embeddings.embedOne(title);
  console.log(`\nquery vector len=${cv.length}`);
  const v = await p.query<{ id: string; score: number; title: string }>(
    `SELECT ie.item_id AS id, 1 - (ie.embedding <=> $1::vector) AS score, i.title
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE i.user_id = $2
        AND i.status = 'ready'
        AND ie.embedding_kind = 'real'
      ORDER BY ie.embedding <=> $1::vector
      LIMIT 3`,
    [`[${cv.join(',')}]`, userId]
  );
  console.log('pgvector nearest (query = first item title):');
  for (const r of v.rows) console.log(`  - score=${r.score.toFixed(4)} title="${r.title.slice(0, 60)}"`);

  // Embed a paraphrase of one of the existing items and confirm
  // it surfaces the original via the vector leg of runSearch.
  const paraphrase = 'mạng xã hội trực tuyến nổi tiếng do Mark Zuckerberg sáng lập';
  const cv2 = await ai.embeddings.embedOne(paraphrase);
  console.log(`\nparaphrase query vector len=${cv2.length}`);
  const v2 = await p.query<{ id: string; score: number; title: string }>(
    `SELECT ie.item_id AS id, 1 - (ie.embedding <=> $1::vector) AS score, i.title
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE i.user_id = $2
        AND i.status = 'ready'
        AND ie.embedding_kind = 'real'
      ORDER BY ie.embedding <=> $1::vector
      LIMIT 3`,
    [`[${cv2.join(',')}]`, userId]
  );
  console.log('pgvector nearest (paraphrase = "Facebook is an online social network..."):');
  for (const r of v2.rows) console.log(`  - score=${r.score.toFixed(4)} title="${r.title.slice(0, 60)}"`);
} finally {
  await p.end();
}
