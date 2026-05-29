// apps/desktop/src/hooks/useTheme.tsx
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { registry, defaultTheme, getTheme } from '../themes/registry';
import { getStorageItem, setStorageItem } from '../utils/storage';

interface ThemeContextValue {
  theme: string;
  themes: { id: string; name: string }[];
  setTheme: (id: string) => void;
}

function useThemeState(): ThemeContextValue {
  const [theme, setThemeState] = useState(() => {
    const stored = getStorageItem('cabinet-theme');
    if (stored && getTheme(stored)) return stored;
    return defaultTheme.id;
  });

  const setTheme = useCallback((id: string) => {
    if (!getTheme(id)) return;
    setThemeState(id);
    setStorageItem('cabinet-theme', id);
    document.documentElement.setAttribute('data-theme', id);
  }, []);

  // Initialize data-theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const themes = registry.map((t) => ({ id: t.id, name: t.name }));

  return { theme, themes, setTheme };
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useThemeState();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  const fallback = useThemeState();
  return ctx ?? fallback;
}
