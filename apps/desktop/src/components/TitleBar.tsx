import { useState, useEffect, useCallback } from 'react';

function useTauriWindow() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      const hasTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
      if (!hasTauri) return;

      import('@tauri-apps/api/core')
        .then(() => {
          if (!cancelled) setAvailable(true);
        })
        .catch(() => {});
    } catch {}
    return () => { cancelled = true; };
  }, []);

  return { available };
}

async function invoke(name: string): Promise<any> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(name);
}

export function TitleBar({ isDark, onToggleTheme }: { isDark?: boolean; onToggleTheme?: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const { available } = useTauriWindow();

  useEffect(() => {
    if (!available) return;
    let cancelled = false;

    // Initial check
    invoke('is_maximized').then(v => { if (!cancelled) setIsMaximized(Boolean(v)); }).catch(() => {});

    // Listen for resize events to update maximize state
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      const unlisten = listen('tauri://resize', () => {
        invoke('is_maximized').then(v => setIsMaximized(Boolean(v))).catch(() => {});
      });
      return () => { unlisten.then((fn: () => void) => fn()); };
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [available]);

  const handleMinimize = useCallback(() => invoke('minimize').catch(() => {}), []);
  const handleMaximize = useCallback(() => invoke('maximize').catch(() => {}), []);
  const handleClose = useCallback(() => invoke('close').catch(() => {}), []);

  const btnHover = isDark
    ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700';

  return (
    <div
      data-tauri-drag-region
      className={`h-8 flex items-center justify-between select-none flex-shrink-0 border-b ${
        isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div data-tauri-drag-region className="flex items-center pl-4">
        <span className={`text-xs font-semibold tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          Cabinet
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex items-center h-full">
        {onToggleTheme && (
          <button onClick={onToggleTheme} className={`w-8 h-full flex items-center justify-center transition-colors ${btnHover}`} aria-label="Toggle theme">
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="7" cy="7" r="3" /><path d="M7 0v2M7 12v2M0 7h2M12 7h2M2 2l1.5 1.5M10.5 10.5L12 12M2 12l1.5-1.5M10.5 3.5L12 2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M11 8A5 5 0 016 3a3.5 3.5 0 105 5z" />
              </svg>
            )}
          </button>
        )}

        {available && (
          <>
            <button onClick={handleMinimize} className={`w-10 h-full flex items-center justify-center transition-colors ${btnHover}`} aria-label="Minimize">
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor" /></svg>
            </button>
            <button onClick={handleMaximize} className={`w-10 h-full flex items-center justify-center transition-colors ${btnHover}`} aria-label="Maximize">
              {isMaximized ? (
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="0.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1" /><rect x="0.5" y="2.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              )}
            </button>
            <button onClick={handleClose} className={`w-10 h-full flex items-center justify-center transition-colors ${isDark ? 'text-gray-400 hover:bg-red-600 hover:text-white' : 'text-gray-500 hover:bg-red-600 hover:text-white'}`} aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
