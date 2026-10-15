import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeSwitch } from '../ThemeSwitch';
import { THEME_MODE_KEY } from '../../../lib/theme';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the 3 theme buttons: Sáng, Tối, Hệ thống', () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole('radio', { name: /Giao diện Sáng/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Giao diện Tối/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Theo thiết lập của máy tính/i })).toBeInTheDocument();
  });

  it('allows switching to Light mode', async () => {
    render(<ThemeSwitch />);
    const lightBtn = screen.getByRole('radio', { name: /Giao diện Sáng/i });
    await userEvent.click(lightBtn);

    expect(lightBtn).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(THEME_MODE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('allows switching to Dark mode', async () => {
    render(<ThemeSwitch />);
    const darkBtn = screen.getByRole('radio', { name: /Giao diện Tối/i });
    await userEvent.click(darkBtn);

    expect(darkBtn).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(THEME_MODE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('allows switching to System mode', async () => {
    render(<ThemeSwitch />);
    const systemBtn = screen.getByRole('radio', { name: /Theo thiết lập của máy tính/i });
    await userEvent.click(systemBtn);

    expect(systemBtn).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(THEME_MODE_KEY)).toBe('system');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system');
  });

  it('renders in compact mode without text labels', () => {
    const { container } = render(<ThemeSwitch compact />);
    expect(container.querySelector('.theme-switch-label')).toBeNull();
  });
});
