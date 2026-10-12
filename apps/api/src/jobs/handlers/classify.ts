/**
 * Classify job handler (spec 0005 §5.6, §5.7).
 *
 * Flow:
 *   1. Look up the parent item via the ItemRepository. Skip the
 *      job (mark as `skipped`) if the item is gone, soft-deleted,
 *      or has no body to classify.
 *   2. Read the existing classification row (if any) to honour
 *      the idempotence key: `(item_id, classifier_version,
 *      content_hash)`. If the latest row already has the
 *      current classifier_version and the same content_hash,
 *      mark the job completed without re-classifying.
 *   3. Run the configured ContentClassifier.
 *   4. Persist the result via ClassificationRepository.
 *   5. Re-enqueue an `embed` job ONLY when the AI description
 *      changed. We compare new.description to the previous row;
 *      the spec forbids automatic rescoring on classifier
 *      upgrade (v1-no-rescore).
 *
 * Critical invariants:
 *   - A failed classification NEVER marks the item as `failed`.
 *     The handler writes `status='failed'` on the
 *     `item_classifications` row only; the item row stays
 *     usable.
 *   - The handler treats the noop classifier's `skipped` output
 *     as a normal successful path: write a row, re-enqueue
 *     `embed` if the description changed.
 *   - On Gemini failure the handler returns an `error_code` on
 *     the row but does NOT re-throw; the JobQueue marks the
 *     job failed and the item remains `ready`/usable.
 */
import type { Pool } from 'pg';
import { createClassificationRepository, createItemRepository, type DetectedType } from '@mnemonics/database';
import type { ContentClassifier, AiService } from '@mnemonics/ai';
import { contentHash as hashText } from '@mnemonics/ai';
import type { Job, JobQueue } from '../queue.js';

export interface ClassifyHandlerOptions {
  queue: JobQueue;
  pool: Pool;
  ai: AiService;
}

export class ClassifyHandler {
  private readonly queue: JobQueue;
  private readonly pool: Pool;
  private readonly ai: AiService;

  constructor(opts: ClassifyHandlerOptions) {
    this.queue = opts.queue;
    this.pool = opts.pool;
    this.ai = opts.ai;
  }

  async handle(job: Job): Promise<void> {
    const classifier: ContentClassifier | undefined = this.ai.classifier;
    if (!classifier) {
      // The AI service was constructed without a classifier
      // (e.g. a test stub that doesn't implement
      // `AiService.classifier`). Mark the job as completed
      // and bail out — the queue cannot progress otherwise.
      await this.queue.markCompleted(job.id).catch(() => undefined);
      return;
    }
    const items = createItemRepository(this.pool);
    const classifications = createClassificationRepository(this.pool);

    const item = await items.findById(job.itemId);
    if (!item) {
      // The item was deleted between enqueue and execution.
      // Persist a `skipped` row so the queue is consistent with
      // the database; no embed re-enqueue.
      await this.safeUpsert(classifications, job, {
        detectedType: null,
        category: null,
        description: null,
        attributes: {},
        entities: [],
        evidence: {},
        confidence: null,
        provider: classifier.info().name,
        model: classifier.info().model,
        classifierVersion: classifier.info().version,
        status: 'skipped',
        errorCode: 'ITEM_GONE',
        contentHash: null
      });
      await this.queue.markCompleted(job.id).catch(() => undefined);
      return;
    }

    if (item.status === 'failed') {
      // We never re-classify a failed item — keep the
      // classification row aligned.
      await this.queue.markCompleted(job.id).catch(() => undefined);
      return;
    }

    const body = item.rawText || '';
    const contentHash = await hashText([item.id, body, item.title || '']);
    const sourceMetadata = (item as any).sourceMetadata ?? null;

    const previous = await classifications.findByItemId(item.id, item.userId);
    if (
      previous &&
      previous.classifierVersion === classifier.info().version &&
      previous.contentHash === contentHash
    ) {
      // Idempotent: same version, same content. Mark the job
      // completed so the queue can move on.
      await this.queue.markCompleted(job.id).catch(() => undefined);
      return;
    }

    let result;
    try {
      result = await classifier.classify({
        itemId: item.id,
        userId: item.userId,
        type: (item.type as any) ?? 'link',
        title: item.title || '',
        body,
        sourceUrl: item.sourceUrl ?? null,
        sourceMetadata,
        contentHash
      });
    } catch (err) {
      // CRITICAL: a classifier failure must NOT bubble up to
      // the JobQueue's "mark item as failed" terminal handler
      // either. We catch here, write a `failed` row, and let
      // the JobQueue mark THIS job as failed; the parent item
      // remains usable.
    await this.safeUpsert(classifications, job, {
      detectedType: null,
      category: null,
      description: null,
      attributes: {},
      entities: [],
      evidence: {},
      confidence: null,
      provider: classifier.info().name,
      model: classifier.info().model,
      classifierVersion: classifier.info().version,
      status: 'failed',
      errorCode: 'CLASSIFIER_ERROR',
      contentHash
    });
    await this.queue.markCompleted(job.id).catch(() => undefined);
    return;
  }

    // Spec 0005 §20 review-focus 1: if the previous
    // classification row has any `evidence[k] = 'user'`,
    // those keys are user-set and must NOT be overwritten
    // by the classifier. Merge: keep user values, fill the
    // rest with the new classifier result.
    const userOverrides: Record<string, string> = {};
    if (previous && previous.evidence) {
      for (const [k, v] of Object.entries(previous.evidence)) {
        if (v === 'user' && previous.attributes && k in previous.attributes) {
          userOverrides[k] = String(previous.attributes[k]);
        }
      }
    }
    const mergedAttributes: Record<string, unknown> = {
      ...(result.attributes || {}),
      ...userOverrides
    };
    const mergedEvidence: Record<string, string> = {
      ...(result.evidence || {}),
      ...Object.fromEntries(Object.keys(userOverrides).map((k) => [k, 'user']))
    };

    await this.safeUpsert(classifications, job, {
      detectedType: result.detectedType,
      category: result.category,
      description: result.description,
      attributes: mergedAttributes,
      entities: result.entities,
      evidence: mergedEvidence,
      confidence: result.confidence,
      provider: classifier.info().name,
      model: classifier.info().model,
      classifierVersion: result.classifierVersion,
      status: result.status,
      errorCode: result.status === 'failed' ? 'CLASSIFIER_FAILED' : null,
      contentHash
    });

    // Re-enqueue embed only when the description actually
    // changed. The spec forbids automatic rescoring on
    // classifier upgrade (v1-no-rescore).
    const descriptionChanged =
      !previous || previous.description !== result.description;
    if (descriptionChanged && result.description) {
      await this.queue.create({
        type: 'embed',
        itemId: item.id,
        userId: item.userId,
        payload: { reason: 'classifier-description-changed' }
      });
    }

    await this.queue.markCompleted(job.id).catch(() => undefined);
  }

  /**
   * Wrap the upsert in a try/catch so an unhandled DB error
   * doesn't escape the job handler (which would mark the
   * item as failed by the queue's terminal-failure hook).
   */
  private async safeUpsert(
    classifications: ReturnType<typeof createClassificationRepository>,
    job: Job,
    payload: {
      detectedType: DetectedType | null;
      category: string | null;
      description: string | null;
      attributes: Record<string, unknown>;
      entities: Array<Record<string, unknown>>;
      evidence: Record<string, string>;
      confidence: number | null;
      provider: string;
      model: string;
      classifierVersion: string;
      status: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
      errorCode: string | null;
      contentHash: string | null;
    }
  ): Promise<void> {
    try {
      await classifications.upsert({
        itemId: job.itemId,
        userId: job.userId,
        ...payload
      });
    } catch (err) {
      console.error(
        `[ClassifyHandler] failed to persist classification for ${job.itemId}:`,
        (err as Error).message
      );
    }
  }
}
