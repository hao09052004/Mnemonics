import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageSwitch } from '../LanguageSwitch';
import { LOCALE_STORAGE_KEY } from '../../../lib/locale';

describe('LanguageSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('data-locale');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders both EN and VI language options', () => {
    render(<LanguageSwitch />);
    expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tiếng Việt' })).toBeInTheDocument();
  });

  it('allows switching to Vietnamese mode', async () => {
    render(<LanguageSwitch />);
    const viBtn = screen.getByRole('radio', { name: 'Tiếng Việt' });
    await userEvent.click(viBtn);

    expect(viBtn).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    expect(document.documentElement.getAttribute('data-locale')).toBe('vi');
  });

  it('allows switching back to English mode', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');
    render(<LanguageSwitch />);
    const enBtn = screen.getByRole('radio', { name: 'English' });
    await userEvent.click(enBtn);

    expect(enBtn).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('data-locale')).toBe('en');
  });

  it('renders in compact mode with correct testids', () => {
    render(<LanguageSwitch compact />);
    expect(screen.getByTestId('lang-mode-en')).toBeInTheDocument();
    expect(screen.getByTestId('lang-mode-vi')).toBeInTheDocument();
  });
});
