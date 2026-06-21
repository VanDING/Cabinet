import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

export function useScanner() {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<unknown[]>([]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/workbench/agents/scan', { method: 'POST' });
      const data = await res.json();
      setResults(data.results ?? []);
      return data.results;
    } finally {
      setScanning(false);
    }
  }, []);

  return { scanning, results, scan };
}
