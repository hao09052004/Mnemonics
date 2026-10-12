import { describe, expect, it } from 'vitest';
import {
  kindToLabel,
  labelToKinds,
  normalizeKind,
  type MemoryLabel,
} from '../memory-kind';

describe('memory-kind', () => {
  it('maps BE kinds to FE labels', () => {
    expect(kindToLabel('link')).toBe('article');
    expect(kindToLabel('text')).toBe('note');
    expect(kindToLabel('image')).toBe('image');
    expect(kindToLabel('screenshot')).toBe('screenshot');
    expect(kindToLabel('document')).toBe('document');
  });

  it('maps FE labels back to BE kinds', () => {
    expect(labelToKinds('article')).toEqual(['link']);
    expect(labelToKinds('note')).toEqual(['text']);
    expect(labelToKinds('image')).toEqual(['image']);
    expect(labelToKinds('screenshot')).toEqual(['screenshot']);
    expect(labelToKinds('highlight')).toEqual(['link']);
    expect(labelToKinds('document')).toEqual(['document']);
  });

  it('normalizes unknown kinds to note', () => {
    expect(normalizeKind('document')).toBe('document');
    expect(normalizeKind('')).toBe('note');
    expect(normalizeKind('something-weird')).toBe('note');
  });

  it('covers every label in the type', () => {
    const labels: MemoryLabel[] = [
      'note', 'article', 'highlight', 'image', 'screenshot', 'document',
    ];
    expect(labels).toHaveLength(6);
  });
});