import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EverythingView } from '../EverythingView';

afterEach(() => cleanup());

const items = [
  { id: '1', kind: 'text' as const, title: 'A note', snippet: 'Hello' },
  { id: '2', kind: 'image' as const, title: 'A pic', image_url: 'https://example.com/x.jpg' },
];

interface HarnessProps extends Partial<React.ComponentProps<typeof EverythingView>> {
  onOpen?: () => void;
  onSearch?: (q: string) => void;
}

function view(props: HarnessProps = {}) {
  const onOpen = props.onOpen ?? vi.fn();
  const onSearch = props.onSearch ?? vi.fn();
  const merged: React.ComponentProps<typeof EverythingView> = {
    items: props.items ?? items,
    loading: props.loading ?? false,
    error: props.error ?? null,
    query: props.query ?? '',
    onQueryChange: props.onQueryChange ?? (() => {}),
    onSearch,
    filter: props.filter ?? 'all',
    onFilterChange: props.onFilterChange ?? (() => {}),
    onOpen,
    onCapture: props.onCapture ?? (() => {}),
  };
  const result = render(
    <MemoryRouter>
      <EverythingView {...merged} />
    </MemoryRouter>
  );
  return { ...result, onOpen, onSearch };
}

describe('EverythingView', () => {
  it('renders one card per item', () => {
    view();
    expect(screen.getByText('A note')).toBeTruthy();
    expect(screen.getByText('A pic')).toBeTruthy();
  });

  it('renders the empty state when items is empty and not loading', () => {
    view({ items: [] });
    expect(screen.getByText(/your memory starts here/i)).toBeTruthy();
  });

  it('renders the no-results state when query is set and items is empty', () => {
    view({ items: [], query: 'nothing' });
    expect(screen.getByText(/no memories found/i)).toBeTruthy();
  });

  it('does not call onSearch when submitting an empty query', () => {
    const { onSearch } = view();
    const form = screen.getByRole('search');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('calls onSearch when the form is submitted with a non-empty query', () => {
    const { onSearch } = view({ query: 'hello' });
    const form = screen.getByRole('search');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSearch).toHaveBeenCalledWith('hello');
  });

  it('renders the token-expired empty state when error is TOKEN_EXPIRED', () => {
    view({ error: 'TOKEN_EXPIRED' });
    expect(screen.getByText(/session expired/i)).toBeTruthy();
  });
});