import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentTypeChipRow } from '../ContentTypeChipRow';

afterEach(() => cleanup());

describe('ContentTypeChipRow', () => {
  it('marks the active one', () => {
    render(<ContentTypeChipRow active="all" onChange={() => {}} />);
    const active = screen.getByRole('button', { pressed: true });
    expect(active.textContent).toBe('All');
  });

  it('fires onChange when clicked', async () => {
    const onChange = vi.fn();
    render(<ContentTypeChipRow active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onChange).toHaveBeenCalledWith('note');
  });
});