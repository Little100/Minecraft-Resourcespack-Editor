import { useState, useEffect, useCallback, useMemo } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface UseThemeReturn {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  resolvedTheme: ResolvedTheme;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {}
    return 'system';
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme = useMemo(
    () => (theme === 'system' ? systemTheme : theme),
    [theme, systemTheme]
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('theme', newTheme);
    } catch {}
  }, []);

  return { theme, setTheme, resolvedTheme };
}
