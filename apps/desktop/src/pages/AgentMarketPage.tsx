import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { useToast } from '../components/Toast';
import { AgentBadge } from '../components/AgentBadge';

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
    elevated: boolean;
    url?: string;
  }>;
}

interface InstalledAgent {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
  config?: {
    apiKeys: Array<{ provider: string; source: string }>;
    mcpServers: Array<{ name: string; source: string }>;
    skills: Array<{ name: string; source: string }>;
    configFiles: string[];
  } | null;
}

export function AgentMarketContent({ embedded = false }: { embedded?: boolean } = {}) {
  const { addToast } = useToast();
  const [marketAgents, setMarketAgents] = useState<MarketAgent[]>([]);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installDialog, setInstallDialog] = useState<MarketAgent | null>(null);

  const fetchMarket = useCallback(async () => {
    try {
      const res = await apiFetch('/api/install/market', { headers: authHeaders() });
      const data = await res.json();
      setMarketAgents(data.agents ?? []);
    } catch {
      setMarketAgents([]);
    }
  }, []);

  const deepScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/install/deep-scan', {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      setInstalledAgents(data.agents ?? []);
      addToast('success', `Scanned: ${data.agents?.length ?? 0} agents found`);
    } catch {
      addToast('error', 'Deep scan failed');
    } finally {
      setScanning(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchMarket().then(() => setLoading(false));
    deepScan();
  }, [fetchMarket, deepScan]);

  const isInstalled = (agentId: string) => installedAgents.some((a) => a.id === agentId && a.installed);

  if (loading) {
    return <div className="text-content-tertiary p-8 text-center text-sm">Loading agent market...</div>;
  }

  return (
    <div className={embedded ? 'space-y-6' : 'space-y-6 p-6'}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-content-primary text-xl font-bold">Agent Market</h1>
            <p className="text-content-tertiary mt-1 text-sm">
              Install and manage AI coding agents. Deep scan reads existing configs.
            </p>
          </div>
          <button
            onClick={deepScan}
            disabled={scanning}
            className="bg-accent text-accent-foreground hover:bg-accent-hover rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Deep Scan'}
          </button>
        </div>
      )}

      {/* Installed agents section */}
      {installedAgents.length > 0 && (
        <div>
          <h2 className="text-content-secondary mb-3 text-sm font-semibold">
            Detected Agents ({installedAgents.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {installedAgents.map((agent) => (
              <div
                key={agent.id}
                className="border-border bg-surface-elevated rounded-lg border p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-content-primary font-semibold">{agent.name}</div>
                    <div className="text-content-tertiary mt-0.5 text-xs font-mono">{agent.command}</div>
                    {agent.version && (
                      <div className="text-content-tertiary mt-1 text-xs">v{agent.version}</div>
                    )}
                  </div>
                  <span className="bg-intent-success-muted text-intent-success rounded-full px-2 py-0.5 text-xs">
                    Installed
                  </span>
                </div>
                {agent.config && (agent.config.apiKeys.length > 0 || agent.config.mcpServers.length > 0) && (
                  <div className="mt-3 space-y-1 border-t border-[var(--border-color)] pt-2">
                    {agent.config.apiKeys.length > 0 && (
                      <div className="text-xs text-content-secondary">
                        API Keys: {agent.config.apiKeys.map((k) => k.provider).join(', ')}
                      </div>
                    )}
                    {agent.config.mcpServers.length > 0 && (
                      <div className="text-xs text-content-secondary">
                        MCP Servers: {agent.config.mcpServers.map((s) => s.name).join(', ')}
                      </div>
                    )}
                    {agent.config.configFiles.length > 0 && (
                      <div className="text-[10px] text-content-tertiary">
                        Config: {agent.config.configFiles.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available for install section */}
      <div>
        <h2 className="text-content-secondary mb-3 text-sm font-semibold">
          Available Agents ({marketAgents.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {marketAgents.map((agent) => {
            const installed = isInstalled(agent.id);
            return (
              <div
                key={agent.id}
                className="border-border bg-surface-elevated rounded-lg border p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-content-primary font-semibold">{agent.name}</div>
                    <div className="text-content-tertiary mt-0.5 text-xs">{agent.description}</div>
                    <div className="text-content-tertiary mt-1 text-xs font-mono">{agent.command}</div>
                  </div>
                  {installed ? (
                    <span className="bg-intent-success-muted text-intent-success rounded-full px-2 py-0.5 text-xs">
                      Installed
                    </span>
                  ) : (
                    <button
                      onClick={() => setInstallDialog(agent)}
                      className="bg-accent text-accent-foreground hover:bg-accent-hover rounded-md px-3 py-1 text-xs font-medium transition-colors"
                    >
                      Install
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.methods.map((m, i) => (
                    <span
                      key={i}
                      className="bg-surface-muted text-content-tertiary rounded px-1.5 py-0.5 text-[10px]"
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Install Dialog */}
      {installDialog && (
        <InstallDialog
          agent={installDialog}
          onClose={() => setInstallDialog(null)}
          onInstalled={() => {
            setInstallDialog(null);
            deepScan();
          }}
        />
      )}
    </div>
  );
}

function InstallDialog({
  agent,
  onClose,
  onInstalled,
}: {
  agent: MarketAgent;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const { addToast } = useToast();
  const [selectedMethod, setSelectedMethod] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const handleInstall = async () => {
    setInstalling(true);
    setOutput([]);
    setCompleted(false);
    setFailed(false);

    try {
      const res = await apiFetch('/api/install/install', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ agentId: agent.id, methodIndex: selectedMethod }),
      });

      const reader = res.body?.getReader();
      if (!reader) {
        addToast('error', 'Failed to start install stream');
        setInstalling(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            // Next data: line contains the payload
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.data) {
                setOutput((prev) => [...prev, payload.data]);
              }
              if (payload.exitCode === 0) {
                setCompleted(true);
                setTimeout(() => onInstalled(), 1000);
              } else if (payload.exitCode && payload.exitCode !== 0) {
                setFailed(true);
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }
      }
    } catch {
      setFailed(true);
      addToast('error', 'Install failed');
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-elevated border-border w-full max-w-lg rounded-xl border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-content-primary text-lg font-bold">Install {agent.name}</h2>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content-primary text-xl"
          >
            ×
          </button>
        </div>

        <p className="text-content-secondary mb-4 text-sm">{agent.description}</p>

        {/* Method selection */}
        <div className="mb-4">
          <label className="text-content-secondary mb-2 block text-xs font-semibold">Installation Method</label>
          <div className="space-y-2">
            {agent.methods.map((method, i) => (
              <button
                key={i}
                onClick={() => setSelectedMethod(i)}
                disabled={installing}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedMethod === i
                    ? 'border-accent bg-accent-muted'
                    : 'border-border bg-surface-primary hover:bg-surface-muted'
                }`}
              >
                <div>
                  <div className="text-content-primary text-sm font-medium">{method.label}</div>
                  <div className="text-content-tertiary text-xs font-mono">{method.command}</div>
                </div>
                {selectedMethod === i && <span className="text-accent">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Install output */}
        {(installing || output.length > 0) && (
          <div className="mb-4">
            <label className="text-content-secondary mb-1 block text-xs font-semibold">Output</label>
            <div
              ref={outputRef}
              className="bg-surface-muted h-40 overflow-y-auto rounded-lg p-3 font-mono text-xs"
            >
              {output.map((line, i) => (
                <div key={i} className="text-content-secondary whitespace-pre-wrap">
                  {line}
                </div>
              ))}
              {installing && <div className="text-accent animate-pulse">▋</div>}
            </div>
          </div>
        )}

        {/* Status */}
        {completed && (
          <div className="bg-intent-success-muted text-intent-success mb-4 rounded-lg p-3 text-sm">
            ✓ Installation completed! Running deep scan...
          </div>
        )}
        {failed && (
          <div className="bg-intent-danger-muted text-intent-danger mb-4 rounded-lg p-3 text-sm">
            ✕ Installation failed. Check the output above.
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border-border text-content-secondary hover:bg-surface-muted rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={installing || completed}
            className="bg-accent text-accent-foreground hover:bg-accent-hover rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {installing ? 'Installing...' : completed ? 'Done' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentMarketPage() {
  return (
    <div className="h-full overflow-y-auto">
      <AgentMarketContent />
    </div>
  );
}
