import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../utils/api.js';

export interface AgentInfo {
  id: string;
  name: string;
  model?: string;
  kind: 'ai' | 'human';
  source: 'builtin' | 'custom' | 'external_cli' | 'external_a2a';
  status: 'active' | 'idle' | 'offline';
  expertise: string[];
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/employees', { headers: authHeaders() });
      const data = await res.json();
      const all: AgentInfo[] = data.employees ?? [];
      setAgents(all.filter((e) => e.kind === 'ai'));
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}
