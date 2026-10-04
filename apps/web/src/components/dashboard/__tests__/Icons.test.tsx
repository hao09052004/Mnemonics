import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../Icons';

describe('Icon', () => {
  it('renders every documented icon name', () => {
    const names = [
      'grid', 'star', 'layers', 'sparkle', 'bell', 'settings',
      'search', 'sliders', 'arrow', 'more', 'heart', 'plus',
      'chevron', 'clock', 'link', 'x', 'check', 'image',
      'file', 'share', 'copy', 'upload',
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
});