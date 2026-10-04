import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from '../CaptureSheet';

afterEach(() => cleanup());

describe('CaptureSheet', () => {
  it('renders 4 actions', () => {
    render(<CaptureSheet open onClose={() => {}} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: /save link/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /quick note/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload document/i })).toBeTruthy();
  });

  it('fires onAction with the action key', async () => {
    const onAction = vi.fn();
    render(<CaptureSheet open onClose={() => {}} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: /quick note/i }));
    expect(onAction).toHaveBeenCalledWith('note');
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(<CaptureSheet open onClose={onClose} onAction={() => {}} />);
    await userEvent.click(screen.getByTestId('capture-sheet'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});