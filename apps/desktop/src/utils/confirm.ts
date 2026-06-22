/**
 * Safe confirmation dialog — uses Tauri native dialog when available,
 * falls back to browser confirm() when Tauri API is not ready.
 */
export async function safeConfirm(message: string): Promise<boolean> {
  try {
    if ((window as any).__TAURI__) {
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      return await confirm(message);
    }
  } catch {
    // Tauri dialog not available — fall through to browser confirm
  }
  return window.confirm(message);
}
