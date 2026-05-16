import { useEffect, useRef, useCallback } from 'react';
import { getPin } from '../utils/pin.js';

type WSEventHandler = (type: string, data: any) => void;

export function useWebSocket(onEvent?: WSEventHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const pin = getPin();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const url = `${protocol}//${host}:3000/ws/events`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ pin }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onEventRef.current?.(msg.type, msg);
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {}
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { send };
}
