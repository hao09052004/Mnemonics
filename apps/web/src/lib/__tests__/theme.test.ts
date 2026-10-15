import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyTheme,
  getStoredThemeMode,
  getSystemTheme,
  resolveTheme,
  THEME_MODE_KEY,
  type ThemeMode,
} from '../theme';

describe('theme library', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
  });

  it('defaults to system mode when nothing is stored', () => {
    expect(getStoredThemeMode()).toBe('system');
  });

  it('reads stored theme mode accurately', () => {
    localStorage.setItem(THEME_MODE_KEY, 'light');
    expect(getStoredThemeMode()).toBe('light');

    localStorage.setItem(THEME_MODE_KEY, 'dark');
    expect(getStoredThemeMode()).toBe('dark');

    localStorage.setItem(THEME_MODE_KEY, 'system');
    expect(getStoredThemeMode()).toBe('system');
  });

  it('resolves light and dark modes directly', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves system mode based on matchMedia query', () => {
    const res = resolveTheme('system');
    expect(['light', 'dark']).toContain(res);
  });

  it('applies data-theme and data-theme-mode to DOM', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark');
  });
});
