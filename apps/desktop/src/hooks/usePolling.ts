import { useEffect, useRef, useState, useCallback } from 'react';

export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const result = await fetcher();
      if (ctrl.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    let visible = true;

    const run = () => {
      if (!visible) return;
      tick();
      timerRef.current = setTimeout(run, interval);
    };

    run();

    const onVis = () => {
      visible = !document.hidden;
      if (visible) tick();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [tick, interval]);

  return { data, error, loading, refresh: tick };
}
