import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODE_KEY = 'mnemonics_theme_mode';
export const LEGACY_THEME_KEY = 'mnemonics_theme';
const THEME_CHANGE_EVENT = 'mnemonics-theme-change';

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_MODE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      return legacy;
    }
  } catch {
    // ignore local storage errors
  }
  return 'system';
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')?.matches
      ? 'dark'
      : 'light';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = resolveTheme(mode);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-mode', mode);
    if (document.body) {
      document.body.setAttribute('data-theme', resolved);
      document.body.setAttribute('data-theme-mode', mode);
    }
    try {
      document.documentElement.style.colorScheme = resolved;
    } catch {
      // ignore
    }
  }
  return resolved;
}

/**
 * Hook to read and control theme across the application.
 * Synchronizes across multiple components and reacts to OS preference changes in system mode.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [resolved, setResolvedState] = useState<'light' | 'dark'>(() =>
    resolveTheme(getStoredThemeMode())
  );

  useEffect(() => {
    // Initial sync
    const initialMode = getStoredThemeMode();
    const currentResolved = applyTheme(initialMode);
    setModeState(initialMode);
    setResolvedState(currentResolved);

    // Listen to window custom event for cross-component sync
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ mode: ThemeMode; resolved: 'light' | 'dark' }>;
      if (customEvent.detail) {
        setModeState(customEvent.detail.mode);
        setResolvedState(customEvent.detail.resolved);
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

    // Listen to storage event for cross-tab sync
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_MODE_KEY && e.newValue) {
        const nextMode = (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system')
          ? e.newValue
          : 'system';
        const nextResolved = applyTheme(nextMode);
        setModeState(nextMode);
        setResolvedState(nextResolved);
      }
    };
    window.addEventListener('storage', handleStorage);

    // Listen to system prefers-color-scheme changes
    let mql: MediaQueryList | null = null;
    let mqlListener: (() => void) | null = null;

    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        if (query) {
          mql = query;
          mqlListener = () => {
            if (getStoredThemeMode() === 'system') {
              const res = applyTheme('system');
              setResolvedState(res);
            }
          };
          if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', mqlListener);
          } else if (typeof (mql as any).addListener === 'function') {
            (mql as any).addListener(mqlListener);
          }
        }
      }
    } catch {
      // ignore matchMedia errors in tests or older browsers
    }

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
      if (mql && mqlListener) {
        try {
          if (typeof mql.removeEventListener === 'function') {
            mql.removeEventListener('change', mqlListener);
          } else if (typeof (mql as any).removeListener === 'function') {
            (mql as any).removeListener(mqlListener);
          }
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    try {
      localStorage.setItem(THEME_MODE_KEY, nextMode);
      const res = applyTheme(nextMode);
      localStorage.setItem(LEGACY_THEME_KEY, res);
      setModeState(nextMode);
      setResolvedState(res);

      // Notify other components on page
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, {
          detail: { mode: nextMode, resolved: res },
        })
      );
    } catch {
      const res = applyTheme(nextMode);
      setModeState(nextMode);
      setResolvedState(res);
    }
  };

  return { mode, resolved, setMode };
}
