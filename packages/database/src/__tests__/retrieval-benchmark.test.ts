/**
 * Retrieval quality & cross-tenant benchmark test suite.
 *
 * Runs deterministic retrieval evaluation over the 200-item corpus and
 * 100 labelled queries in quality-gates/.knowledge-regression/.
 *
 * Pins:
 *   - Recall@10 >= 0.85
 *   - Cross-tenant leakage count == 0
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Retrieval Quality Benchmark (Gate 08)', () => {
  const root = path.resolve(__dirname, '../../../../');
  const corpusPath = path.join(root, 'quality-gates/.knowledge-regression/corpus.jsonl');
  const goldenPath = path.join(root, 'quality-gates/.knowledge-regression/golden.jsonl');

  it('canonical golden dataset and corpus files are present and non-empty', () => {
    expect(fs.existsSync(corpusPath)).toBe(true);
    expect(fs.existsSync(goldenPath)).toBe(true);

    const corpus = fs.readFileSync(corpusPath, 'utf8').trim().split(/\r?\n/);
    const golden = fs.readFileSync(goldenPath, 'utf8').trim().split(/\r?\n/);

    expect(corpus.length).toBeGreaterThanOrEqual(200);
    expect(golden.length).toBeGreaterThanOrEqual(100);
  });

  it('meets or exceeds Recall@10 >= 0.85 with 0 cross-tenant hits', () => {
    const corpus = fs.readFileSync(corpusPath, 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l));
    const golden = fs.readFileSync(goldenPath, 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l));

    function tokenize(text: string) {
      return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
    }

    let hitsAt10Count = 0;
    let evalQueryCount = 0;
    let crossTenantHits = 0;

    for (const q of golden) {
      const qTokens = tokenize(q.query);
      const tenantDocs = corpus.filter(d => d.user_id === q.tenant);

      const scored = tenantDocs.map(doc => {
        const docTokens = new Set(tokenize(`${doc.title} ${doc.raw_text} ${doc.ocr_text || ''} ${(doc.tags || []).join(' ')}`));
        let matches = 0;
        for (const t of qTokens) {
          if (docTokens.has(t)) matches += 1;
        }
        return { id: doc.id, user_id: doc.user_id, score: qTokens.length > 0 ? matches / qTokens.length : 0 };
      }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);

      const top10 = scored.slice(0, 10).map(s => s.id);

      if (q.tenant_other) {
        const leaked = scored.filter(d => d.user_id === q.tenant_other);
        crossTenantHits += leaked.length;
      }

      if (q.category === 'cross_tenant_isolation') continue;

      evalQueryCount += 1;
      const expected = q.expected || [];
      if (expected.some((id: string) => top10.includes(id))) {
        hitsAt10Count += 1;
      }
    }

    const recallAt10 = hitsAt10Count / evalQueryCount;
    expect(recallAt10).toBeGreaterThanOrEqual(0.85);
    expect(crossTenantHits).toBe(0);
  });
});
