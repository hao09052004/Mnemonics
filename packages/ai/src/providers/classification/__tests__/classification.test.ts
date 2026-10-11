/**
 * Classifier providers — unit tests (spec 0005 §4).
 *
 *  - NoopContentClassifier returns a stable, idempotent
 *    `skipped` result.
 *  - classificationResultSchema rejects out-of-vocabulary
 *    detected_type and out-of-range confidence.
 *  - buildContentClassifier returns Noop when the project
 *    runs in free-only mode without a Gemini client.
 */
import { describe, it, expect } from 'vitest';
import { NoopContentClassifier, buildContentClassifier, classificationResultSchema, detectedTypeSchema } from '../index.js';

describe('Classifier providers (M2)', () => {
  it('NoopContentClassifier always returns status=skipped', async () => {
    const c = new NoopContentClassifier();
    const r = await c.classify({
      itemId: 'i1', userId: 'u1',
      type: 'link', title: 't', body: 'b',
      sourceUrl: null, sourceMetadata: null, contentHash: 'sha:x'
    });
    expect(r.status).toBe('skipped');
    expect(r.detectedType).toBeNull();
    expect(r.classifierVersion).toBe('v1-noop');
    expect(c.info().isFallback).toBe(true);
  });

  it('buildContentClassifier prefers Gemini in free mode when apiKey provided', () => {
    // The factory does not hit the network; the unit test
    // checks provider selection only. We pass a real (unused)
    // client stub from the type's standpoint by providing a
    // shape with the required call method (this test does not
    // exercise call()).
    const c = buildContentClassifier({
      freeOnly: true,
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      geminiClient: { call: async () => ({}) } as any
    });
    expect(c.info().isFallback).toBe(false);
    expect(c.info().name).toBe('gemini');
  });

  it('buildContentClassifier returns Noop when free mode has no apiKey', () => {
    const c = buildContentClassifier({
      freeOnly: true,
      apiKey: null,
      model: 'gemini-3.8-flash',
      geminiClient: { call: async () => ({}) } as any
    });
    expect(c.info().name).toBe('noop');
  });

  it('detectedTypeSchema rejects out-of-vocabulary kinds', () => {
    const r = detectedTypeSchema.safeParse('not-a-kind');
    expect(r.success).toBe(false);
  });

  it('classificationResultSchema rejects out-of-range confidence', () => {
    const r = classificationResultSchema.safeParse({
      detectedType: 'webpage', category: null, description: null,
      attributes: {}, entities: [], evidence: {},
      confidence: 1.5,
      classifierVersion: 'v1', status: 'ready'
    });
    expect(r.success).toBe(false);
  });

  it('classificationResultSchema accepts a well-formed ready result', () => {
    const r = classificationResultSchema.safeParse({
      detectedType: 'product', category: 'furniture', description: 'a chair',
      attributes: { material: 'wood' }, entities: [],
      evidence: { material: 'structured_data' },
      confidence: 0.9,
      classifierVersion: 'v1', status: 'ready'
    });
    expect(r.success).toBe(true);
  });
});
