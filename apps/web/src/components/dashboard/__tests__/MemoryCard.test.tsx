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

  it('shows the body snippet for every variant, including highlight', () => {
    // Regression: the highlight branch used to suppress the snippet, so a
    // selected-text card rendered title + source only.
    render(
      <MemoryCard
        item={{
          ...baseItem('a9'),
          kind: 'link',
          selectedText: '"All our dreams can come true…"',
          snippet: 'The Psychology of Possibility',
        }}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByText('The Psychology of Possibility')).toBeTruthy();
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
  it('keeps the overflow menu but drops the delete entry without a handler', async () => {
    const user = userEvent.setup();
    render(<MemoryCard item={baseItem('a10')} onOpen={vi.fn()} />);
    // The "..." trigger is always present (it opens the detail view), but
    // the destructive entry must not exist when no delete handler is given.
    await user.click(screen.getByTestId('item-more-a10'));
    expect(screen.queryByTestId('item-menu-delete-a10')).toBeNull();
  });

  it('opens an overflow menu with favorite + delete entries', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <MemoryCard
        item={baseItem('a11')}
        onOpen={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={onDelete}
      />
    );

    // Nothing is shown until "..." is clicked.
    expect(screen.queryByTestId('item-menu-delete-a11')).toBeNull();
    await user.click(screen.getByTestId('item-more-a11'));

    const menuDelete = screen.getByTestId('item-menu-delete-a11');
    expect(menuDelete).toBeTruthy();

    await user.click(menuDelete);
    expect(onDelete).toHaveBeenCalledOnce();
    // The menu must close after acting.
    expect(screen.queryByTestId('item-menu-delete-a11')).toBeNull();
  });

  it('closes the overflow menu on Escape', async () => {
    const user = userEvent.setup();
    render(<MemoryCard item={baseItem('a13')} onOpen={vi.fn()} onDelete={vi.fn()} />);
    await user.click(screen.getByTestId('item-more-a13'));
    expect(screen.getByTestId('item-menu-delete-a13')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('item-menu-delete-a13')).toBeNull();
  });

  it('marks the heart as pressed and filled when already favorited', () => {
    render(
      <MemoryCard
        item={{ ...baseItem('a14'), is_favorite: true }}
        onOpen={vi.fn()}
        onToggleFavorite={vi.fn()}
      />
    );
    const heart = screen.getByTestId('item-favorite-a14');
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });

  it('disables the heart while the favorite request is in flight', () => {
    render(
      <MemoryCard
        item={baseItem('a15')}
        onOpen={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriting
      />
    );
    expect((screen.getByTestId('item-favorite-a15') as HTMLButtonElement).disabled).toBe(true);
  });
});
