import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyLocale,
  getStoredLocale,
  LOCALE_STORAGE_KEY,
  DICTIONARY,
  type Locale,
} from '../locale';

describe('locale library', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('data-locale');
  });

  it('reads stored locale accurately from localStorage', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');
    expect(getStoredLocale()).toBe('vi');

    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(getStoredLocale()).toBe('en');
  });

  it('applies lang and data-locale attributes to documentElement', () => {
    applyLocale('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    expect(document.documentElement.getAttribute('data-locale')).toBe('vi');

    applyLocale('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('data-locale')).toBe('en');
  });

  it('contains valid translation entries for en and vi', () => {
    expect(DICTIONARY.nav_product.en).toBe('Product');
    expect(DICTIONARY.nav_product.vi).toBe('Sản phẩm');
    expect(DICTIONARY.hero_headline_1.en).toBe('Remember everything,');
    expect(DICTIONARY.hero_headline_1.vi).toBe('Ghi nhớ tất cả,');
  });
});
