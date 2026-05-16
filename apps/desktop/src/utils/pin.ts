/** Check if running inside Tauri (production or dev with tauri). */
function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
  } catch { return false; }
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

/** Get the current PIN for API requests. Reads from localStorage, falls back to '1234'. */
export function getPin(): string {
  try {
    return localStorage.getItem('cabinet-pin') ?? '1234';
  } catch {
    return '1234';
  }
}

/** Shorthand: returns { 'x-cabinet-pin': getPin() } for fetch headers. */
export function authHeaders(): { 'x-cabinet-pin': string; 'Content-Type'?: string } {
  return { 'x-cabinet-pin': getPin() };
}

/** Returns headers object with Content-Type for JSON requests. */
export function authJsonHeaders(): { 'x-cabinet-pin': string; 'Content-Type': string } {
  return { 'x-cabinet-pin': getPin(), 'Content-Type': 'application/json' };
}
