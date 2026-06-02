import { useState, useEffect, type ReactNode } from 'react';
import { Loader2, AlertTriangle, RefreshCw, KeyRound } from 'lucide-react';
import { checkPinStatus, resetServerPin, regeneratePin } from '../utils/pin.js';

type ServerStatus =
  | 'connecting'
  | 'starting'
  | 'ready'
  | 'timeout'
  | 'crashed'
  | 'restarting'
  | 'fatal'
  | 'pin_mismatch';

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
  const [pinResetting, setPinResetting] = useState(false);

  async function checkAuth() {
    const auth = await checkPinStatus();
    if (!auth.valid && !auth.firstRun) {
      setStatus('pin_mismatch');
      setMessage('PIN authentication failed. The local PIN does not match the server.');
    } else {
      setStatus('ready');
    }
  }

  useEffect(() => {
    if (!isTauri()) {
      setStatus('ready');
      return;
    }

    // Quick health check — server may already be running
    fetch('http://localhost:3000/health')
      .then((r) => {
        if (r.ok) checkAuth();
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
              checkAuth();
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
      .catch((err) => { console.warn('Operation failed', err); });

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
        ) : status === 'pin_mismatch' ? (
          <KeyRound className="h-10 w-10 text-intent-warning" />
        ) : (
          <AlertTriangle className="h-10 w-10 text-intent-warning" />
        )}

        <span className="text-lg font-medium text-content-tertiary">Cabinet</span>

        <span className="text-sm max-w-xs text-center">{message}</span>

        {status === 'pin_mismatch' && (
          <div className="flex flex-col gap-2 mt-2">
            <button
              className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-sm text-white hover:brightness-110"
              disabled={pinResetting}
              onClick={async () => {
                setPinResetting(true);
                setMessage('Resetting PIN...');
                const ok = await resetServerPin();
                if (ok) {
                  setMessage('PIN reset. Checking...');
                  checkAuth();
                } else {
                  setMessage('PIN reset failed. Is the server running?');
                }
                setPinResetting(false);
              }}
            >
              {pinResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reset Server PIN
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-sm bg-surface-primary px-4 py-2 text-sm text-content-tertiary hover:bg-surface-input"
              onClick={() => {
                regeneratePin();
                setMessage('New PIN generated. Now reset the server PIN as well.');
              }}
            >
              Generate New PIN
            </button>
          </div>
        )}

        {(status === 'timeout' || status === 'fatal') && (
          <button
            className="mt-2 inline-flex items-center gap-2 rounded-sm bg-surface-primary px-4 py-2 text-sm text-content-tertiary hover:bg-surface-input"
            onClick={() => {
              setStatus('starting');
              setMessage('Retrying...');
              const check = () => {
                fetch('http://localhost:3000/health')
                  .then((r) => {
                    if (r.ok) checkAuth();
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
