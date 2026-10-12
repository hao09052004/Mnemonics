import { describe, expect, it } from 'vitest';
import { captureInputSchema, normalizeCapture } from './index.js';

describe('captureInputSchema', () => {
  it('normalizes optional capture time and preserves the client request id', () => {
    const parsed = captureInputSchema.parse({
      type: 'link',
      title: 'Example',
      sourceUrl: 'https://example.com',
      clientRequestId: '33333333-3333-4333-8333-333333333333'
    });
    const normalized = normalizeCapture(parsed);
    expect(normalized.clientRequestId).toBe(parsed.clientRequestId);
    expect(normalized.capturedAt).toBeInstanceOf(Date);
  });

  it('rejects image data URLs', () => {
    const result = captureInputSchema.safeParse({
      type: 'image',
      title: 'Image',
      image: { storageKey: 'data:image/png;base64,abc', mimeType: 'image/png', sizeBytes: 3 },
      clientRequestId: '44444444-4444-4444-8444-444444444444'
    });
    expect(result.success).toBe(false);
  });
});