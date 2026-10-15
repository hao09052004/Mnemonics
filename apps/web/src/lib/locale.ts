import { useCallback, useEffect, useState } from 'react';

export type Locale = 'en' | 'vi';

export const LOCALE_STORAGE_KEY = 'mnemonics_locale';
export const LOCALE_CHANGE_EVENT = 'mnemonics-locale-change';

export const DICTIONARY = {
  // Navigation & Header
  nav_product: { en: 'Product', vi: 'Sản phẩm' },
  nav_how_it_works: { en: 'How it works', vi: 'Cách hoạt động' },
  nav_pricing: { en: 'Pricing', vi: 'Bảng giá' },
  nav_extension: { en: 'Browser extension', vi: 'Tiện ích trình duyệt' },
  nav_privacy: { en: 'Privacy', vi: 'Quyền riêng tư' },
  nav_login: { en: 'Log in', vi: 'Đăng nhập' },
  nav_open_app: { en: 'Open Mnemonics', vi: 'Mở Mnemonics' },

  // Dashboard Nav
  nav_everything: { en: 'Everything', vi: 'Mọi thứ' },
  nav_favorites: { en: 'Favorites', vi: 'Yêu thích' },
  nav_groups: { en: 'Groups', vi: 'Nhóm' },
  nav_spaces: { en: 'Spaces', vi: 'Bộ sưu tập' },
  nav_rediscover: { en: 'Rediscover', vi: 'Khám phá lại' },
  nav_reminders: { en: 'Reminders', vi: 'Nhắc nhở' },
  nav_analytics: { en: 'Analytics', vi: 'Phân tích' },
  nav_account: { en: 'Account', vi: 'Tài khoản' },
  nav_admin: { en: 'Admin', vi: 'Quản trị' },
  btn_capture: { en: 'Capture', vi: 'Thu thập' },
  btn_logout: { en: 'Log out', vi: 'Đăng xuất' },

  // Marketing Hero
  hero_pill_badge: { en: 'CHROME STORE', vi: 'CHROME STORE' },
  hero_pill_text: { en: 'Official extension is now live', vi: 'Tiện ích chính thức đã có mặt' },
  hero_headline_1: { en: 'Remember everything,', vi: 'Ghi nhớ tất cả,' },
  hero_headline_2: { en: 'without organising everything.', vi: 'mà không cần sắp xếp.' },
  hero_lead: {
    en: 'Mnemonics captures pages, thoughts, images and highlights — then quietly connects them so you can find them later by meaning, not by filename.',
    vi: 'Mnemonics ghi nhớ trang web, suy nghĩ, hình ảnh và trích dẫn — kết nối thông minh để bạn tìm lại theo ý nghĩa, không cần nhớ tên file.'
  },
  hero_add_chrome: { en: 'Add to Chrome', vi: 'Thêm vào Chrome' },
  hero_add_edge: { en: 'Add to Edge', vi: 'Thêm vào Edge' },
  hero_open_web_app: { en: 'Open the web app →', vi: 'Mở ứng dụng web →' },
  hero_browser_compat: {
    en: 'Chrome · Edge · Brave · Chromium-based browsers',
    vi: 'Chrome · Edge · Brave · Trình duyệt nhân Chromium'
  },

  // Final CTA
  cta_eyebrow: { en: 'Save it now', vi: 'Lưu lại ngay' },
  cta_headline: { en: 'Remember it later.', vi: 'Nhớ lại sau.' },
  cta_lead: {
    en: 'Mnemonics is a private, AI-shaped second brain. It works best when it lives where you already spend your day — the browser.',
    vi: 'Mnemonics là bộ não thứ hai riêng tư, định hình bởi AI. Hoạt động mượt mà nhất ngay tại nơi bạn làm việc mỗi ngày — trình duyệt web.'
  },
  cta_open_web_app: { en: 'Open web app', vi: 'Mở ứng dụng web' },

  // Capture Section
  capture_eyebrow: { en: 'Capture', vi: 'Thu thập' },
  capture_headline_1: { en: 'One click.', vi: 'Một lần nhấn.' },
  capture_headline_2: { en: 'Safely remembered.', vi: 'Ghi nhớ an toàn.' },
  capture_lead: {
    en: "Click the Mnemonics browser button while you're on a page. We save the article, the highlight, the screenshot — whichever you need — without you leaving the tab.",
    vi: 'Nhấn biểu tượng Mnemonics khi đang lướt web. Toàn bộ bài viết, trích dẫn, ảnh chụp màn hình được lưu lại tức thì mà không cần rời tab.'
  },
  capture_btn_install: { en: 'Get the browser extension', vi: 'Cài tiện ích trình duyệt' },

  // Theme Switch
  theme_light: { en: 'Light', vi: 'Sáng' },
  theme_dark: { en: 'Dark', vi: 'Tối' },
  theme_system: { en: 'System', vi: 'Hệ thống' },
  theme_title_light: { en: 'Light interface (White)', vi: 'Giao diện Sáng (Trắng)' },
  theme_title_dark: { en: 'Dark interface (Black)', vi: 'Giao diện Tối (Đen)' },
  theme_title_system: { en: 'Follow system preference', vi: 'Theo thiết lập của máy tính (Hệ thống)' },

  // Language Switch
  lang_label_theme: { en: 'Theme', vi: 'Giao diện' },
  lang_label_language: { en: 'Language', vi: 'Ngôn ngữ' },
  lang_en: { en: 'English', vi: 'Tiếng Anh' },
  lang_vi: { en: 'Vietnamese', vi: 'Tiếng Việt' },
  lang_title_en: { en: 'Switch to English', vi: 'Chuyển sang Tiếng Anh' },
  lang_title_vi: { en: 'Switch to Vietnamese', vi: 'Chuyển sang Tiếng Việt' },

  // Search
  search_placeholder: {
    en: 'Search by meaning, quote or tag...',
    vi: 'Tìm theo ý nghĩa, trích dẫn hoặc thẻ...'
  }
} as const;

export type TranslationKey = keyof typeof DICTIONARY;

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'vi') {
      return stored;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi')) {
      return 'vi';
    }
  } catch {
    // ignore
  }

  return 'en';
}

export function applyLocale(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('data-locale', locale);
    if (document.body) {
      document.body.setAttribute('data-locale', locale);
    }
  }
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());

  const setLocale = useCallback((nextLocale: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      applyLocale(nextLocale);
    } catch {
      // ignore
    }
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale: nextLocale } })
      );
    }
  }, []);

  useEffect(() => {
    // Initial sync
    const current = getStoredLocale();
    applyLocale(current);
    setLocaleState(current);

    const handleLocaleChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ locale: Locale }>;
      if (customEvent.detail?.locale) {
        setLocaleState(customEvent.detail.locale);
      }
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && (e.newValue === 'en' || e.newValue === 'vi')) {
        setLocaleState(e.newValue);
        applyLocale(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const t = useCallback(
    (key: TranslationKey | string, fallback?: string): string => {
      const entry = DICTIONARY[key as TranslationKey];
      if (entry && entry[locale]) {
        return entry[locale];
      }
      return fallback || key;
    },
    [locale]
  );

  return { locale, setLocale, t };
}
