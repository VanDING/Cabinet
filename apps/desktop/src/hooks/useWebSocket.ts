import { useEffect, useRef, useCallback } from 'react';

type WSEventHandler = (type: string, data: any) => void;

export function useWebSocket(onEvent?: WSEventHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnecting = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (reconnecting.current) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const url = `${protocol}//${host}:3000/ws/events`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onEventRef.current?.(msg.type, msg);
        } catch {
          /* skip malformed messages */
        }
      };

      ws.onclose = () => {
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
        // Let onclose fire naturally — do not call ws.close() here
      };
    } catch {
      /* WebSocket construction failed */
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      reconnecting.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { send };
}
