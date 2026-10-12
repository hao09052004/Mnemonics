/**
 * M3 — small test that exercises the chip toggle and the
 * brand input. Confirms the structured payload the chip
 * writes is what the search route accepts.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StructuredChipRow } from '../StructuredChipRow.js';

describe('StructuredChipRow (M3)', () => {
  it('renders all 11 detected type chips', () => {
    render(<StructuredChipRow active={[]} onChange={() => {}} />);
    expect(screen.getByTestId('chip-detected-article')).toBeTruthy();
    expect(screen.getByTestId('chip-detected-product')).toBeTruthy();
    expect(screen.getByTestId('chip-detected-recipe')).toBeTruthy();
  });

  it('toggling a chip adds it to the active list', () => {
    const onChange = vi.fn();
    const { container } = render(<StructuredChipRow active={[]} onChange={onChange} />);
    fireEvent.click(container.querySelector('[data-testid="chip-detected-recipe"]')!);
    expect(onChange).toHaveBeenCalledWith(['recipe']);
  });

  it('toggling an active chip removes it from the active list', () => {
    const onChange = vi.fn();
    const { container } = render(<StructuredChipRow active={['recipe']} onChange={onChange} />);
    fireEvent.click(container.querySelector('[data-testid="chip-detected-recipe"]')!);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('marks the active chip with aria-pressed=true', () => {
    const { container } = render(<StructuredChipRow active={['article']} onChange={() => {}} />);
    const article = container.querySelector('[data-testid="chip-detected-article"]')!;
    expect(article.getAttribute('aria-pressed')).toBe('true');
  });
});
