import { useState, useEffect, useCallback } from 'react';
import { Palette, Minus, Maximize2, RectangleHorizontal, X, ChevronDown } from 'lucide-react';
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

interface ThemeInfo { id: string; name: string; }
export function TitleBar({
  themes,
  currentTheme,
  onSetTheme,
}: {
  themes: ThemeInfo[];
  currentTheme: string;
  onSetTheme?: (id: string) => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const { available } = useTauriWindow();
  const [themeOpen, setThemeOpen] = useState(false);
  const currentThemeName = themes.find((t) => t.id === currentTheme)?.name ?? 'Theme';

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
    'text-gray-500 hover:bg-gray-100 hover:text-gray-700:bg-gray-700:text-gray-200';

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 flex-shrink-0 select-none items-center justify-between border-b border-gray-200 bg-white"
    >
      <div data-tauri-drag-region className="flex items-center pl-4">
        <span className="text-xs font-semibold tracking-wide text-gray-600">
          Cabinet
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex h-full items-center">
        <NotificationBell />

        <div className="relative">
          <button
            onClick={() => setThemeOpen((v) => !v)}
            className={`flex h-full items-center gap-1 px-2 text-xs transition-colors ${btnHover}`}
            aria-label="Select theme"
          >
            <Palette size={14} />
            <span className="hidden sm:inline">{currentThemeName}</span>
            <ChevronDown size={10} />
          </button>
          {themeOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setThemeOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { onSetTheme?.(t.id); setThemeOpen(false); }}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 ${
                      t.id === currentTheme
                        ? 'font-semibold text-blue-600'
                        : 'text-gray-700'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

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
              className="flex h-full w-10 items-center justify-center text-gray-500 transition-colors hover:bg-red-600 hover:text-white"
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
