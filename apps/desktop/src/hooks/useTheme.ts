import { useState, useEffect } from 'react';
import { getStorageItem, setStorageItem } from '../utils/storage.js';

export function useTheme() {
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
