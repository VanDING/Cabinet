import { useState, useEffect, createContext, useContext } from 'react';
import { getStorageItem, setStorageItem } from '../utils/storage.js';

function useThemeState() {
  const [isDark, setIsDark] = useState(() => {
    const stored = getStorageItem('cabinet-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    setStorageItem('cabinet-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return { isDark, toggle: () => setIsDark((d) => !d) };
}

const ThemeContext = createContext<ReturnType<typeof useThemeState> | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeState();
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  const fallback = useThemeState();
  return ctx ?? fallback;
}
