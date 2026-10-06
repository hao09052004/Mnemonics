import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchZone } from '../SearchZone';

afterEach(() => cleanup());

function searchInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Search your memories' }) as HTMLInputElement;
}

describe('SearchZone', () => {
  it('renders an empty input with placeholder', () => {
    render(<SearchZone value="" onChange={() => {}} />);
    expect(searchInput().value).toBe('');
  });

  it('calls onChange when the user types', async () => {
    const onChange = vi.fn();
    render(<SearchZone value="" onChange={onChange} />);
    await userEvent.type(searchInput(), 'hi');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows the kbd hint', () => {
    render(<SearchZone value="" onChange={() => {}} />);
    expect(screen.getByText('⌘ K')).toBeTruthy();
  });
});