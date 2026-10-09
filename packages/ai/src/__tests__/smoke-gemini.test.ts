/**
 * Live smoke test for Gemini tag generation.
 *
 * Only runs when the SMOKE_GEMINI env var is set, to avoid CI hits
 * against the public Gemini API. Use:
 *   SMOKE_GEMINI=1 npx vitest run smoke-gemini.test.ts
 */
import { describe, expect, it } from 'vitest';
import { GeminiTextProvider } from '../providers/text/gemini.js';
import { GeminiClient } from '../gemini-client.js';

const runLive = process.env.SMOKE_GEMINI === '1';

(runLive ? describe : describe.skip)('Gemini text (live)', () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  it('returns real JSON tags for a sample', async () => {
    if (!apiKey) throw new Error('GEMINI_API_KEY must be set for this smoke test');
    const provider = new GeminiTextProvider(apiKey, model, new GeminiClient());
    const tags = await provider.generateTags(
      'Captured a recipe for sourdough bread: 500g flour, 350g water, 100g starter, 10g salt. Mix, bulk ferment 4-6 hours, shape, cold proof overnight, bake at 230C in a dutch oven.'
    );
    console.log('tags:', tags);
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(5);
    tags.forEach(t => {
      expect(t).toMatch(/^[a-z0-9-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(3);
    });
  }, 30_000);
});