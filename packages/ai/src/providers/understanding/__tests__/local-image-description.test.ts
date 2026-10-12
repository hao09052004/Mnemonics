import { describe, it, expect } from 'vitest';
import { LocalImageDescriptionProvider } from '../local-image-description.js';

describe('LocalImageDescriptionProvider', () => {
  it('returns a placeholder when download is disabled', async () => {
    const provider = new LocalImageDescriptionProvider({ allowDownload: false });
    const out = await provider.describe({
      bytes: new Uint8Array([0]),
      mimeType: 'image/png'
    });
    expect(out.caption.length).toBeGreaterThan(0);
    expect(out.provider).toBe('local');
    expect(out.model).toBe('placeholder-v1');
  });

  it('reports the configured model name in info()', () => {
    const provider = new LocalImageDescriptionProvider({
      allowDownload: false,
      modelName: 'Xenova/vit-gpt2-image-captioning'
    });
    const info = provider.info();
    expect(info.name).toBe('local');
    expect(info.model).toBe('Xenova/vit-gpt2-image-captioning');
    expect(info.loaded).toBe(false);
  });
});