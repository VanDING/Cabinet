import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api.js';
import { useToast } from '../../components/Toast.js';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import { AgentMarketGrid } from './AgentMarketGrid.js';

interface AgentEntry {
  id: string;
  recipe: { id: string; name: string; icon: string; description: string };
  installed: boolean;
  version?: string;
}

export function AgentsTab() {
  const { addToast } = useToast();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'market'>('list');
  const [scanning, setScanning] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/workbench/agents');
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/workbench/agents/scan', { method: 'POST' });
      await res.json();
      addToast('success', 'Scan complete');
      await fetchAgents();
    } catch {
      addToast('error', 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {scanning ? 'Scanning\u2026' : 'Scan installed'}
            </button>
            <button
              onClick={() => setView(view === 'list' ? 'market' : 'list')}
              className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-sm"
            >
              {view === 'list' ? 'Agent Market' : 'Back to list'}
            </button>
          </div>
        </div>
        {view === 'market' ? (
          <AgentMarketGrid onInstalled={fetchAgents} />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  selectedId === a.id
                    ? 'border-accent'
                    : 'hover:bg-surface-muted border-[var(--border-color)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.recipe.name}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${a.installed ? 'bg-intent-success' : 'bg-surface-input'}`}
                  />
                </div>
                <div className="text-content-tertiary mt-1 text-xs">
                  {a.installed ? (a.version ?? 'installed') : 'not installed'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedId && <AgentDetailPanel agentId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
