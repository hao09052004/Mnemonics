import { describe, expect, it } from 'vitest';
import { extractSmartTags } from '../smart-tags';

describe('extractSmartTags', () => {
  it('extracts top keywords and ignores stopwords', () => {
    const text = 'Learning machine learning and deep learning for artificial intelligence';
    const tags = extractSmartTags(text);
    expect(tags).toContain('learning');
    expect(tags).toContain('machine');
    expect(tags).not.toContain('and');
    expect(tags).not.toContain('for');
  });

  it('supports Vietnamese text', () => {
    const text = 'Lập trình ứng dụng web React với React và Supabase';
    const tags = extractSmartTags(text);
    expect(tags).toContain('react');
    expect(tags).not.toContain('với');
    expect(tags).not.toContain('và');
  });

  it('falls back to default label when text is empty or too short', () => {
    expect(extractSmartTags('')).toEqual(['ghi chú']);
    expect(extractSmartTags('ab', 'trích dẫn')).toEqual(['trích dẫn']);
  });
});
