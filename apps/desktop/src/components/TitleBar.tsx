import { useState, useEffect, useCallback } from 'react';
import { Sun, Moon, Minus, Maximize2, RectangleHorizontal, X } from 'lucide-react';
import { NotificationBell } from './NotificationBell';

function useTauriWindow() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      const hasTauri =
        typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
      if (!hasTauri) return;

      import('@tauri-apps/api/core')
        .then(() => {
          if (!cancelled) setAvailable(true);
        })
        .catch(() => {});
    } catch {
      /* Tauri API not available */
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return { available };
}

async function invoke(name: string): Promise<any> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(name);
}

export function TitleBar({ onToggleTheme }: { onToggleTheme?: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const { available } = useTauriWindow();

  useEffect(() => {
    if (!available) return;
    let cancelled = false;

    invoke('is_maximized')
      .then((v) => {
        if (!cancelled) setIsMaximized(Boolean(v));
      })
      .catch(() => {});

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        if (cancelled) return;
        const unlisten = listen('tauri://resize', () => {
          invoke('is_maximized')
            .then((v) => setIsMaximized(Boolean(v)))
            .catch(() => {});
        });
        return () => {
          unlisten.then((fn: () => void) => fn());
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [available]);

  const handleMinimize = useCallback(() => invoke('minimize').catch(() => {}), []);
  const handleMaximize = useCallback(() => invoke('maximize').catch(() => {}), []);
  const handleClose = useCallback(() => invoke('close').catch(() => {}), []);

  const btnHover =
    'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200';

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 flex-shrink-0 select-none items-center justify-between border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      <div data-tauri-drag-region className="flex items-center pl-4">
        <span className="text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300">
          Cabinet
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex h-full items-center">
        <NotificationBell />

        <button
          onClick={onToggleTheme}
          className={`flex h-full w-8 items-center justify-center transition-colors ${btnHover}`}
          aria-label="Toggle theme"
        >
          <Sun size={14} className="block dark:hidden" />
          <Moon size={14} className="hidden dark:block" />
        </button>

        {available && (
          <>
            <button
              onClick={handleMinimize}
              className={`flex h-full w-10 items-center justify-center transition-colors ${btnHover}`}
              aria-label="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={handleMaximize}
              className={`flex h-full w-10 items-center justify-center transition-colors ${btnHover}`}
              aria-label="Maximize"
            >
              {isMaximized ? <RectangleHorizontal size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={handleClose}
              className="flex h-full w-10 items-center justify-center text-gray-500 transition-colors hover:bg-red-600 hover:text-white dark:text-gray-400"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
