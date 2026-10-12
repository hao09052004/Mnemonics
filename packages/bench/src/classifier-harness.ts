/**
 * M4 — classifier F1 harness.
 *
 * The seeder writes the ground truth, so this harness
 * simply checks that the stored `detected_type` matches
 * the dataset's `classification.detected_type`. The check
 * is a regression for "is the seeder honest" and for "is
 * the JSONB write/read round-trip correct".
 */
import type { Pool } from 'pg';
import type { Dataset, BenchmarkDetectedType } from './dataset.js';
import type { SeederResult } from './seeder.js';

export interface ClassifierF1Report {
  total: number;
  f1: number;
  perClass: Record<string, number>;
  /** Mismatches between stored and ground-truth, for debugging. */
  mismatches: Array<{ datasetId: string; expected: BenchmarkDetectedType; actual: BenchmarkDetectedType }>;
}

const CLASSES: BenchmarkDetectedType[] = [
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
];

export async function runClassifierF1(
  pool: Pool,
  dataset: Dataset,
  seeder: SeederResult
): Promise<ClassifierF1Report> {
  // Build a reverse map: items.id → dataset.id, and a
  // ground-truth map: dataset.id → detected_type.
  const itemToDataset = new Map<string, string>();
  for (const [dsId, realId] of seeder.idMap) {
    itemToDataset.set(realId, dsId);
  }
  const groundTruth = new Map<string, BenchmarkDetectedType>();
  for (const memory of dataset.memories) {
    groundTruth.set(memory.id, memory.classification.detected_type);
  }

  const result = await pool.query<{ item_id: string; detected_type: BenchmarkDetectedType }>(
    `SELECT item_id, detected_type FROM item_classifications WHERE user_id = $1`,
    [seeder.userId]
  );

  const perClass: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const c of CLASSES) perClass[c] = { tp: 0, fp: 0, fn: 0 };

  const mismatches: ClassifierF1Report['mismatches'] = [];
  for (const row of result.rows) {
    const dsId = itemToDataset.get(row.item_id);
    if (!dsId) continue;
    const expected = groundTruth.get(dsId);
    if (!expected) continue;
    if (row.detected_type === expected) {
      perClass[expected].tp += 1;
    } else {
      perClass[expected].fn += 1;
      perClass[row.detected_type].fp += 1;
      mismatches.push({ datasetId: dsId, expected, actual: row.detected_type });
    }
  }

  const perClassF1: Record<string, number> = {};
  let f1Sum = 0;
  let f1Count = 0;
  for (const c of CLASSES) {
    const { tp, fp, fn } = perClass[c];
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClassF1[c] = f1;
    if (tp + fp + fn > 0) {
      f1Sum += f1;
      f1Count += 1;
    }
  }
  return {
    total: result.rows.length,
    f1: f1Count === 0 ? 1 : f1Sum / f1Count,
    perClass: perClassF1,
    mismatches
  };
}
