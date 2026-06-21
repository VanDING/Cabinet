import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api.js';
import { InstallDialog } from './InstallDialog.js';

interface MarketAgent {
  id: string;
  name: string;
  description: string;
  command: string;
  methods: Array<{
    type: string;
    label: string;
    command: string;
    checkCommand: string;
    elevated?: boolean;
  }>;
}

export function AgentMarketGrid({ onInstalled }: { onInstalled: () => void }) {
  const [agents, setAgents] = useState<MarketAgent[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState<{
    agent: MarketAgent;
    method: { label: string; command: string; checkCommand: string; elevated?: boolean };
  } | null>(null);

  const fetchMarket = useCallback(async () => {
    try {
      const res = await apiFetch('/api/install/market');
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    void fetchMarket();
  }, [fetchMarket]);

  const handleInstall = async (
    agent: MarketAgent,
    method: { label: string; command: string; checkCommand: string; elevated?: boolean },
  ) => {
    setInstalling(agent.id);
    setShowInstall({ agent, method });
  };

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">Agent Market</h3>
      <div className="grid grid-cols-3 gap-3">
        {agents.map((a) => {
          const best = a.methods[0];
          return (
            <div key={a.id} className="rounded-lg border border-[var(--border-color)] p-4">
              <div className="mb-1 font-medium">{a.name}</div>
              <div className="text-content-tertiary mb-3 text-xs">{a.description}</div>
              <button
                disabled={installing === a.id || !best}
                onClick={() => best && handleInstall(a, best)}
                className="bg-accent text-accent-foreground rounded-md px-3 py-1 text-xs disabled:opacity-50"
              >
                {installing === a.id
                  ? 'Installing\u2026'
                  : best
                    ? `Install via ${best.label}`
                    : 'No installer'}
              </button>
            </div>
          );
        })}
      </div>
      {showInstall && (
        <InstallDialog
          agent={showInstall.agent}
          method={showInstall.method}
          onClose={() => {
            setShowInstall(null);
            setInstalling(null);
          }}
          onDone={() => {
            setShowInstall(null);
            setInstalling(null);
            onInstalled();
          }}
        />
      )}
    </div>
  );
}
