import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../Icons';

describe('Icon', () => {
  it('renders every documented icon name', () => {
    const names = [
      'grid', 'star', 'layers', 'sparkle', 'bell', 'settings',
      'search', 'sliders', 'arrow', 'more', 'heart', 'plus',
      'chevron', 'clock', 'link', 'x', 'check', 'image',
      'file', 'share', 'copy', 'upload', 'trash',
    ] as const;
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('respects the size prop', () => {
    const { container } = render(<Icon name="search" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
  });

  it('renders unfilled by default and filled on request', () => {
    const outline = render(<Icon name="heart" />);
    expect(outline.container.querySelector('svg')?.getAttribute('fill')).toBe('none');
    outline.unmount();

    const filled = render(<Icon name="heart" filled />);
    expect(filled.container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});