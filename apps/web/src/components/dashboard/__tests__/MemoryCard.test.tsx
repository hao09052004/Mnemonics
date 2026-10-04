import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCard, type MemoryCardItem } from '../MemoryCard';

afterEach(() => cleanup());

const baseItem = (id: string): MemoryCardItem => ({
  id,
  kind: 'link',
  title: 'Three-headed dragon',
  snippet: 'A humorous comparison of AI models.',
  source_url: 'https://facebook.com',
  captured_at: new Date().toISOString(),
  tags: ['AI', 'meme'],
});

describe('MemoryCard', () => {
  it('renders an article variant for kind=link', () => {
    render(<MemoryCard item={{ ...baseItem('a1'), kind: 'link' }} onOpen={vi.fn()} />);
    const card = screen.getByTestId('item-card-a1');
    expect(card.className).toContain('article');
    expect(screen.getByText('article')).toBeTruthy();
    expect(screen.getByText('Three-headed dragon')).toBeTruthy();
  });

  it('renders a note variant for kind=text', () => {
    render(<MemoryCard item={{ ...baseItem('a2'), kind: 'text', title: 'A note' }} onOpen={vi.fn()} />);
    expect(screen.getByTestId('item-card-a2').className).toContain('note');
  });

  it('renders a highlight variant when selectedText is present', () => {
    render(
      <MemoryCard
        item={{ ...baseItem('a3'), kind: 'link', selectedText: '"All our dreams can come true…"' }}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByTestId('item-card-a3').className).toContain('highlight');
  });

  it('renders an image variant with image_url', () => {
    render(
      <MemoryCard
        item={{ ...baseItem('a4'), kind: 'image', image_url: 'https://example.com/img.jpg' }}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByTestId('item-card-a4').className).toContain('image');
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('renders text-only (no broken image) when image_url is missing', () => {
    render(<MemoryCard item={{ ...baseItem('a5'), kind: 'image' }} onOpen={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('item-card-a5').className).toContain('image');
  });

  it('renders a disabled document variant for kind=document', () => {
    render(<MemoryCard item={{ ...baseItem('a6'), kind: 'document' }} onOpen={vi.fn()} />);
    expect(screen.getByTestId('item-card-a6').className).toContain('document');
    expect(screen.getByText('Three-headed dragon')).toBeTruthy();
  });

  it('fires onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<MemoryCard item={{ ...baseItem('a7'), kind: 'text' }} onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId('item-card-a7'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('fires onToggleFavorite when the heart is clicked', async () => {
    const onToggleFavorite = vi.fn();
    render(
      <MemoryCard
        item={{ ...baseItem('a8'), kind: 'text' }}
        onOpen={vi.fn()}
        onToggleFavorite={onToggleFavorite}
      />
    );
    await userEvent.click(screen.getByLabelText(/favorite/i));
    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });
});