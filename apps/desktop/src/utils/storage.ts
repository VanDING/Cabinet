/** Safe localStorage wrapper — never throws on quota exceeded or disabled storage. */

export function getStorageItem(key: string, fallback?: string): string | null {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : (fallback ?? null);
  } catch {
    return fallback ?? null;
  }
}

export function setStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function getStorageJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function setStorageJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
