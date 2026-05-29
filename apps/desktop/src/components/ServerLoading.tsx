import { useState, useEffect, type ReactNode } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

type ServerStatus =
  | 'connecting'
  | 'starting'
  | 'ready'
  | 'timeout'
  | 'crashed'
  | 'restarting'
  | 'fatal';

interface StatusPayload {
  status: string;
  message?: string;
  port?: number;
  startupMs?: number;
  restartCount?: number;
  reused?: boolean;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function ServerLoading({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>('connecting');
  const [message, setMessage] = useState('Connecting...');

  useEffect(() => {
    if (!isTauri()) {
      setStatus('ready');
      return;
    }

    // Quick health check — server may already be running
    fetch('http://localhost:3000/health')
      .then((r) => {
        if (r.ok) setStatus('ready');
      })
      .catch(() => setStatus('starting'));

    // Listen for Tauri server-status events
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<StatusPayload>('server-status', (event) => {
          const { status: s, message: msg } = event.payload;
          switch (s) {
            case 'ready':
              setStatus('ready');
              break;
            case 'starting':
              setStatus('starting');
              setMessage(msg ?? 'Starting Cabinet server...');
              break;
            case 'restarting':
              setStatus('restarting');
              setMessage(msg ?? 'Restarting server...');
              break;
            case 'crashed':
              setStatus('crashed');
              setMessage(msg ?? 'Server disconnected. Reconnecting...');
              break;
            case 'timeout':
              setStatus('timeout');
              setMessage(msg ?? 'Server failed to start');
              break;
            case 'fatal':
              setStatus('fatal');
              setMessage(msg ?? 'Server unavailable');
              break;
            default:
              setStatus('fatal');
              setMessage(msg ?? 'Server unavailable');
          }
        }),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  if (status === 'ready') return <>{children}</>;

  const isSpinning =
    status === 'connecting' ||
    status === 'starting' ||
    status === 'crashed' ||
    status === 'restarting';

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-elevated">
      <div className="flex flex-col items-center gap-4 text-content-tertiary">
        {isSpinning ? (
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
        ) : (
          <AlertTriangle className="h-10 w-10 text-amber-400" />
        )}

        <span className="text-lg font-medium text-content-tertiary">Cabinet</span>

        <span className="text-sm">{message}</span>

        {(status === 'timeout' || status === 'fatal') && (
          <button
            className="mt-2 inline-flex items-center gap-2 rounded bg-surface-primary px-4 py-2 text-sm text-content-tertiary hover:bg-surface-input"
            onClick={() => {
              setStatus('starting');
              setMessage('Retrying...');
              const check = () => {
                fetch('http://localhost:3000/health')
                  .then((r) => {
                    if (r.ok) setStatus('ready');
                  })
                  .catch(() => setTimeout(check, 1000));
              };
              check();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
