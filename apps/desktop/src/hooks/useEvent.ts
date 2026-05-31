import { useEffect, useRef } from 'react';
import { useEventBus } from '../contexts/EventBusContext';

export function useEvent(type: string, callback: (data: unknown) => void, debounceMs = 500) {
  const { on } = useEventBus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return on(type, (data) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => callback(data), debounceMs);
    });
  }, [on, type, callback, debounceMs]);
}
