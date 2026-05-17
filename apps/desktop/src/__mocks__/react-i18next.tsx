// Mock react-i18next for tests — returns the key as the translation
// so that existing tests using hardcoded English strings continue to work.

import { vi } from 'vitest';

export function useTranslation() {
  return {
    t: (key: string) => {
      // Return the last segment of the key (e.g., "office" from "nav.office")
      // This approximates the English fallback behavior
      const parts = key.split('.');
      return parts[parts.length - 1] ?? key;
    },
    i18n: {
      changeLanguage: vi.fn(),
      language: 'en',
    },
  };
}

export function Trans({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export const initReactI18next = {
  type: '3rdParty',
  init: vi.fn(),
};

export default {
  useTranslation,
  Trans,
  initReactI18next,
};
