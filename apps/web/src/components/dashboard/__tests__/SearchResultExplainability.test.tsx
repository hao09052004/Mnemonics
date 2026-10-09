/**
 * M7 — MemoryCard explainability pill tests.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryCard, type MemoryCardItem } from '../MemoryCard';

afterEach(() => cleanup());

function baseItem(overrides: Partial<MemoryCardItem> = {}): MemoryCardItem {
  return {
    id: 'item-1',
    kind: 'text',
    title: 'Distributed systems notes',
    snippet: 'retry queues and idempotency',
    captured_at: '2026-09-25T01:00:00.000Z',
    tags: ['backend'],
    ...overrides
  };
}

describe('MemoryCard — M7 explainability pill', () => {
  it('renders the pill when explanation is present', () => {
    render(<MemoryCard item={baseItem({
      explanation: {
        lexical: 0.5,
        vector: 0.7,
        chunk: 0,
        rrf: 0.4,
        rerank: null
      }
    })} />);
    expect(screen.getByText('Why this matched')).toBeInTheDocument();
  });

  it('does not render the pill when explanation is absent', () => {
    render(<MemoryCard item={baseItem()} />);
    expect(screen.queryByText('Why this matched')).toBeNull();
  });

  it('shows the re-rank em-dash when rerank is null', () => {
    render(<MemoryCard item={baseItem({
      explanation: { lexical: 0.1, vector: 0.2, chunk: 0, rrf: 0.3, rerank: null }
    })} />);
    // The <details> is collapsed by default; open it for the test.
    const summary = screen.getByText('Why this matched') as HTMLElement;
    summary.click();
    // The em-dash for null rerank.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the four-decimal score when rerank is a number', () => {
    render(<MemoryCard item={baseItem({
      explanation: { lexical: 0.1234, vector: 0.5678, chunk: 0, rrf: 0.3456, rerank: 0.7890 }
    })} />);
    const summary = screen.getByText('Why this matched') as HTMLElement;
    summary.click();
    expect(screen.getByText('0.1234')).toBeInTheDocument();
    expect(screen.getByText('0.5678')).toBeInTheDocument();
    expect(screen.getByText('0.3456')).toBeInTheDocument();
    expect(screen.getByText('0.7890')).toBeInTheDocument();
  });
});
