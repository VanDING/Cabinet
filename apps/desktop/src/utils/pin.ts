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

/** Returns empty headers — localhost needs no auth. */
export function authHeaders(): Record<string, string> {
  return {};
}

/** Returns headers with Content-Type for JSON requests. */
export function authJsonHeaders(): { 'Content-Type': string } {
  return { 'Content-Type': 'application/json' };
}
