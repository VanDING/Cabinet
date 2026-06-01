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
