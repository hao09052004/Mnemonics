/**
 * M4 — Golden dataset.
 *
 * 60 memories, 30 queries. Lives at
 * `specs/data/relevance-benchmark/dataset.json` and is
 * loaded with `loadDataset()`. The shape is the same one
 * `seedBenchmarkDataset()` consumes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export type BenchmarkType = 'link' | 'text' | 'image' | 'screenshot' | 'document';
export type BenchmarkDetectedType =
  | 'article' | 'product' | 'recipe' | 'video' | 'quote'
  | 'highlight' | 'webpage' | 'image' | 'note' | 'document' | 'other';

export interface BenchmarkMemory {
  id: string;
  title: string;
  type: BenchmarkType;
  raw_text: string;
  captured_at: string;
  tags: string[];
  source_url: string | null;
  classification: {
    detected_type: BenchmarkDetectedType;
    category: string;
    attributes: Record<string, string>;
  };
}

export interface BenchmarkQuery {
  id: string;
  q: string;
  /** Dataset-side ids; the seeder remaps to real `items.id` on insert. */
  relevant_ids: string[];
  labels: Array<'lexical' | 'semantic' | 'structured' | 'hybrid'>;
}

export interface Dataset {
  memories: BenchmarkMemory[];
  queries: BenchmarkQuery[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Loads the dataset from the repository root. Vitest's CWD
 * is the package dir, so we walk up three levels
 * (`packages/bench/dist/` → `packages/bench/` → root).
 */
export function loadDataset(): Dataset {
  const candidates = [
    join(__dirname, '..', '..', '..', 'specs', 'data', 'relevance-benchmark', 'dataset.json'),
    join(__dirname, '..', '..', 'specs', 'data', 'relevance-benchmark', 'dataset.json'),
    join(process.cwd(), 'specs', 'data', 'relevance-benchmark', 'dataset.json')
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf-8');
      return JSON.parse(raw) as Dataset;
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not find relevance-benchmark/dataset.json in: ${candidates.join(', ')}`
  );
}
