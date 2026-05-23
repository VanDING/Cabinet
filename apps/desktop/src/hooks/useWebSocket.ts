import { useEffect, useRef, useCallback, useState } from 'react';

type WSEventHandler = (type: string, data: any) => void;

export function useWebSocket(onEvent?: WSEventHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnecting = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (reconnecting.current) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const url = `${protocol}//${host}:3000/ws/events`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onEventRef.current?.(msg.type, msg);
        } catch {
          /* skip malformed messages */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!reconnecting.current) {
          reconnecting.current = true;
          reconnectTimer.current = setTimeout(() => {
            reconnecting.current = false;
            connect();
          }, 5000);
        }
      };

      ws.onerror = () => {
        setConnected(false);
        // Let onclose fire naturally — do not call ws.close() here
      };
    } catch {
      setConnected(false);
      /* WebSocket construction failed */
    }
  }, []);

  useEffect(() => {
    connect();

    // Coordinate with Tauri server-status events
    let unlisten: (() => void) | undefined;
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      import('@tauri-apps/api/event')
        .then(({ listen }) =>
          listen<{ status: string }>('server-status', (event) => {
            if (event.payload.status === 'ready') {
              // Server is back — reconnect immediately
              clearTimeout(reconnectTimer.current);
              reconnecting.current = false;
              connect();
            }
          }),
        )
        .then((fn) => { unlisten = fn; })
        .catch(() => {});
    }

    return () => {
      reconnecting.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      unlisten?.();
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { send, connected };
}
