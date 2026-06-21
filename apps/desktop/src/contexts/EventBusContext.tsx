import React, { createContext, useContext, useRef, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

interface EventBus {
  emit: (type: string, data: unknown) => void;
  on: (type: string, handler: EventHandler) => () => void;
}

const EventBusContext = createContext<EventBus | null>(null);

export function EventBusProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef<Map<string, Set<EventHandler>>>(new Map());

  const emit = useCallback((type: string, data: unknown) => {
    const set = listeners.current.get(type);
    if (set) set.forEach((h) => h(data));
  }, []);

  const on = useCallback((type: string, handler: EventHandler) => {
    if (!listeners.current.has(type)) listeners.current.set(type, new Set());
    listeners.current.get(type)!.add(handler);
    return () => {
      listeners.current.get(type)?.delete(handler);
    };
  }, []);

  return <EventBusContext.Provider value={{ emit, on }}>{children}</EventBusContext.Provider>;
}

export function useEventBus() {
  const ctx = useContext(EventBusContext);
  if (!ctx) throw new Error('useEventBus must be inside EventBusProvider');
  return ctx;
}
