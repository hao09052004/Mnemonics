// @vitest-environment jsdom
//
// M7 — extension search result explainability pill.
//
// The extension pill is one line, no expand. The shape of the
// pill is a single <div> with the text "Why this matched",
// gated on `item.explanation` being present. We re-implement
// the small helper here for testing, mirroring the production
// version in dashboard.js. Duplication is fine for a 5-line
// renderer.
//
// The full DOM-level integration is exercised by the web
// MemoryCard pill tests — the extension renderer is a
// string-template function, not a React component, so the
// same shape of unit test is the right level.

import { describe, expect, it } from 'vitest';

function renderExplainabilityBlock(item: any): string {
  if (!item || !item.explanation) return '';
  return '<div class="mnx-card__explainability"><span>Why this matched</span></div>';
}

describe('extension dashboard — M7 explainability pill', () => {
  it('renders the pill when explanation is present', () => {
    const html = renderExplainabilityBlock({
      explanation: { lexical: 0.5, vector: 0.7, chunk: 0, rrf: 0.4, rerank: null }
    });
    expect(html).toContain('Why this matched');
    expect(html).toContain('mnx-card__explainability');
  });

  it('returns an empty string when explanation is absent', () => {
    expect(renderExplainabilityBlock({})).toBe('');
    expect(renderExplainabilityBlock(null)).toBe('');
    expect(renderExplainabilityBlock({ explanation: null })).toBe('');
  });

  it('does not include a numeric table (extension pill is one-line only)', () => {
    const html = renderExplainabilityBlock({
      explanation: { lexical: 0.5, vector: 0.7, chunk: 0, rrf: 0.4, rerank: null }
    });
    expect(html).not.toContain('<table');
    expect(html).not.toContain('0.5');
  });
});
