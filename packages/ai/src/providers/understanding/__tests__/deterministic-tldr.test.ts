import { describe, it, expect } from 'vitest';
import { DeterministicTldrProvider } from '../deterministic-tldr.js';

describe('DeterministicTldrProvider', () => {
  const provider = new DeterministicTldrProvider();

  it('caps the tldr length', async () => {
    const long = 'a'.repeat(500);
    const result = await provider.summarize({
      title: long,
      type: 'text',
      rawText: long
    });
    expect(result.tldr.length).toBeLessThanOrEqual(240);
    expect(result.source).toBe('heuristic');
    expect(result.provider).toBe('deterministic');
  });

  it('uses caption when present for image captures', async () => {
    const result = await provider.summarize({
      title: 'A dragon meme',
      caption: 'Three cartoon dragons labeled GPT, Gemini and Claude',
      ocrText: 'GPT-6 GEMINI Claude',
      type: 'image',
      locale: 'vi'
    });
    expect(result.tldr.toLowerCase()).toContain('cartoon dragon');
  });

  it('emits a vi fallback for short text', async () => {
    const result = await provider.summarize({
      title: '',
      rawText: 'Gọi Minh ngày mai',
      type: 'text',
      locale: 'vi'
    });
    expect(result.tldr).toContain('Gọi Minh');
  });

  it('falls back to title for empty image', async () => {
    const result = await provider.summarize({
      title: 'Screenshot của GitHub',
      type: 'screenshot',
      locale: 'vi'
    });
    expect(result.tldr.length).toBeGreaterThan(0);
  });

  it('returns at most 2 sentences', async () => {
    const result = await provider.summarize({
      title: 'Title',
      rawText: 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.',
      ocrText: 'Extra. Extra. Extra. Extra. Extra.',
      caption: 'Image description',
      type: 'text',
      locale: 'vi'
    });
    // Sentence boundary = any of [.!?] followed by whitespace or
    // end-of-string.
    const sentences = result.tldr
      .split(/(?<=[.!?])(?:\s+|$)/u)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });
});