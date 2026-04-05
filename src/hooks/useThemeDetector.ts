import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

export function useThemeDetector(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          const newTheme = document.documentElement.getAttribute('data-theme');
          setTheme(newTheme === 'dark' ? 'dark' : 'light');
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

export function useIsDark(): boolean {
  return useThemeDetector() === 'dark';
}
