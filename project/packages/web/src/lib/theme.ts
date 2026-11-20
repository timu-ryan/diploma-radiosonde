import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'rs-theme';

function initialTheme(): Theme {
  // ?theme=dark удобен для снимков экрана и печати
  const forced = new URLSearchParams(window.location.search).get('theme');
  if (forced === 'light' || forced === 'dark') return forced;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // По умолчанию светлая тема — как на бумажном бланке.
  return 'light';
}

/** Тема хранится в localStorage и проставляется атрибутом data-theme на <html>. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return initialTheme();
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // приватный режим — не страшно
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}
