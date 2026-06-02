/** Check if running inside Tauri (production or dev with tauri). */
function isTauri(): boolean {
  try {
    return (
      typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
    );
  } catch {
    return false;
  }
}

/** Returns the API base URL. Empty string in Vite dev (proxied), absolute in Tauri production. */
export function apiUrl(path: string): string {
  if (isTauri()) {
    return `http://localhost:3000${path}`;
  }
  return path;
}

/** fetch() wrapper that prepends the correct API base URL when running in Tauri. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string' && (input.startsWith('/api/') || input.startsWith('/health/'))) {
    return fetch(apiUrl(input), init);
  }
  return fetch(input, init);
}

/** Persisted PIN for local API authentication. Generated once on first run. */
function getPin(): string {
  const key = 'cabinet:local-pin';
  if (typeof window === 'undefined') return 'cabinet-default';
  let pin = window.localStorage.getItem(key);
  if (!pin) {
    pin = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    window.localStorage.setItem(key, pin);
  }
  return pin;
}

/** Returns auth headers including the local PIN for API access. */
export function authHeaders(): Record<string, string> {
  return { 'x-cabinet-pin': getPin() };
}

/** Returns headers with Content-Type and auth PIN for JSON requests. */
export function authJsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-cabinet-pin': getPin() };
}

/** Check if the server's PIN matches ours. Returns { valid, firstRun }. */
export async function checkPinStatus(): Promise<{ valid: boolean; firstRun: boolean }> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) return { valid: false, firstRun: false };
    return (await res.json()) as { valid: boolean; firstRun: boolean };
  } catch {
    return { valid: false, firstRun: false };
  }
}

/** Reset the server's stored PIN hash so the current client PIN becomes the new PIN. */
export async function resetServerPin(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/reset', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Generate a new PIN, update localStorage, and return the new value. */
export function regeneratePin(): string {
  const pin = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('cabinet:local-pin', pin);
  }
  return pin;
}
