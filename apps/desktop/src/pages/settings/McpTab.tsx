import { useState, useEffect } from 'react';
import { Button, Card, Tag } from '@cabinet/ui';
import { ModalOverlay } from '../../components/ModalOverlay';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';
import { useToast } from '../../components/Toast.js';

// ── Types ──
interface MCPServer {
  name: string;
  transport: {
    type: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
  };
  enabled: boolean;
  env?: Record<string, string>;
  status?: string;
  toolCount?: number;
  resourceCount?: number;
}

interface RecommendedMCP {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  installType: 'direct' | 'path' | 'apikey';
  configFields?: { key: string; label: string; default?: string; placeholder: string }[];
}

// ── Recommended MCP Servers ──
const recommendedServers: RecommendedMCP[] = [
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Chain-of-thought reasoning for complex problem solving',
    category: 'Reasoning',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    installType: 'direct',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation and web scraping',
    category: 'Browser',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-playwright'],
    installType: 'direct',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'File system operations with configurable base path',
    category: 'Tools',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-filesystem'],
    installType: 'path',
    configFields: [
      { key: 'path', label: 'Base Path', default: '~', placeholder: '/path/to/allow' },
    ],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'SQLite database operations',
    category: 'Database',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-sqlite'],
    installType: 'path',
    configFields: [
      {
        key: 'dbPath',
        label: 'Database Path',
        default: '~/.cabinet/data.sqlite',
        placeholder: '/path/to/db.sqlite',
      },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub API access for repo management',
    category: 'API',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-github'],
    installType: 'apikey',
    configFields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        placeholder: 'ghp_xxxxxxxxxxxx',
      },
    ],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API',
    category: 'Search',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-brave-search'],
    installType: 'apikey',
    configFields: [{ key: 'BRAVE_API_KEY', label: 'Brave API Key', placeholder: 'BSxxxxxxxxxxxx' }],
  },
];

// ── Install Modal ──
function InstallModal({
  server,
  onInstall,
  onClose,
}: {
  server: RecommendedMCP | null;
  onInstall: (config: { args?: string[]; env?: Record<string, string> }) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<Record<string, string>>({});

  if (!server) return null;

  const handleInstall = () => {
    if (server.installType === 'path') {
      const pathValue = config.path || server.configFields?.[0]?.default || '~';
      const resolvedPath = pathValue.replace(
        /^~/,
        (window as any).__TAURI__ ? '/home/user' : process?.env?.HOME || '',
      );
      onInstall({ args: [...server.args, resolvedPath] });
    } else if (server.installType === 'apikey') {
      const env: Record<string, string> = {};
      server.configFields?.forEach((f) => {
        if (config[f.key]) env[f.key] = config[f.key]!;
      });
      onInstall({ args: server.args, env });
    } else {
      onInstall({ args: server.args });
    }
  };

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="w-full max-w-sm rounded-xl border border-border bg-surface-overlay p-6 shadow-2xl"
    >
      <h3 className="text-content-primary mb-1 text-lg font-semibold">
        {server.installType === 'direct' ? 'Install' : 'Configure'} {server.name}
      </h3>
      <p className="text-content-tertiary mb-4 text-xs">{server.description}</p>

      {server.installType === 'path' && server.configFields && (
        <div className="space-y-3">
          {server.configFields.map((f) => (
            <div key={f.key}>
              <label className="text-content-secondary mb-1 block text-xs font-medium">
                {f.label}
              </label>
              <input
                type="text"
                value={config[f.key] || f.default || ''}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {server.installType === 'apikey' && server.configFields && (
        <div className="space-y-3">
          {server.configFields.map((f) => (
            <div key={f.key}>
              <label className="text-content-secondary mb-1 block text-xs font-medium">
                {f.label}
              </label>
              <input
                type="password"
                value={config[f.key] || ''}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {server.installType === 'direct' && (
        <p className="text-content-secondary text-sm">
          This server requires no additional configuration.
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleInstall}>
          {server.installType === 'direct' ? 'Install' : 'Install'}
        </Button>
      </div>
    </ModalOverlay>
  );
}

// ── Main Component ──
export function McpTab() {
  const { addToast } = useToast();
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    transportType: 'stdio' as 'stdio' | 'sse',
    command: 'npx',
    args: '',
    url: '',
    enabled: true,
  });
  const [installing, setInstalling] = useState<RecommendedMCP | null>(null);

  const fetchServers = () => {
    apiFetch('/api/settings/mcp-servers', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const configs: MCPServer[] = d.configs ?? [];
        const statuses = d.servers ?? [];
        const merged = configs.map((c) => {
          const s = statuses.find((st: { name: string }) => st.name === c.name);
          return {
            ...c,
            status: s?.connected ? 'connected' : 'disconnected',
            toolCount: s?.toolCount ?? 0,
            resourceCount: s?.resourceCount ?? 0,
          };
        });
        setServers(merged);
      })
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const installedIds = new Set(servers.map((s) => s.name));

  const availableRecommended = recommendedServers.filter((r) => !installedIds.has(r.name));
  // All available recommended servers in a flat list

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    if (form.transportType === 'sse' && !form.url.trim()) return;
    if (form.transportType === 'stdio' && !form.command.trim()) return;

    const newServer: MCPServer = {
      name: form.name.trim(),
      transport:
        form.transportType === 'sse'
          ? { type: 'sse', url: form.url.trim() }
          : {
              type: 'stdio',
              command: form.command.trim(),
              args: form.args.split(/\s+/).filter(Boolean),
            },
      enabled: form.enabled,
    };
    const updated = [...servers.filter((s) => s.name !== newServer.name), newServer];
    try {
      const r = await apiFetch('/api/settings/mcp-servers', {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ configs: updated }),
      });
      if (r.ok) {
        fetchServers();
        setShowForm(false);
        setForm({
          name: '',
          transportType: 'stdio',
          command: 'npx',
          args: '',
          url: '',
          enabled: true,
        });
      }
    } catch {
      /* ignore */
    }
  };

  const handleToggle = async (name: string) => {
    const updated = servers.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s));
    await apiFetch('/api/settings/mcp-servers', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ configs: updated }),
    });
    fetchServers();
  };

  const handleRemove = async (name: string) => {
    const updated = servers.filter((s) => s.name !== name);
    await apiFetch('/api/settings/mcp-servers', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ configs: updated }),
    });
    fetchServers();
  };

  const handleTest = async (name: string) => {
    setTestResult(`Testing ${name}...`);
    try {
      const r = await apiFetch('/api/settings/mcp-servers/test', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (d.status === 'connected')
        setTestResult(`${name}: Connected — ${d.toolCount} tools available`);
      else setTestResult(`${name}: ${d.error ?? 'Connection failed'}`);
    } catch (e) {
      setTestResult(`${name}: ${(e as Error).message}`);
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const handleInstallRecommended = async (config: {
    args?: string[];
    env?: Record<string, string>;
  }) => {
    if (!installing) return;
    const newServer: MCPServer = {
      name: installing.name,
      transport: {
        type: 'stdio',
        command: installing.command,
        args: config.args ?? installing.args,
      },
      enabled: true,
      env: config.env,
    };
    const updated = [...servers.filter((s) => s.name !== newServer.name), newServer];
    try {
      await apiFetch('/api/settings/mcp-servers', {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ configs: updated }),
      });
      addToast('success', `Installed ${installing.name}`);
      setInstalling(null);
      fetchServers();
    } catch {
      addToast('error', `Failed to install ${installing.name}`);
    }
  };

  const renderRecommendedCard = (srv: RecommendedMCP) => (
    <Card key={srv.id} padding="sm" className="relative">
      <div className="pr-16">
        <div className="flex items-center gap-2">
          <span className="text-content-primary text-sm font-medium">{srv.name}</span>
        </div>
        <p className="text-content-tertiary mt-0.5 text-xs">{srv.description}</p>
        <p className="text-content-tertiary mt-1 text-[10px] tracking-wider uppercase">
          {srv.category}
        </p>
      </div>
      <div className="absolute top-2 right-2">
        <Button
          size="xs"
          onClick={() => {
            if (srv.installType === 'direct') {
              setInstalling(srv);
              handleInstallRecommended({ args: srv.args });
            } else {
              setInstalling(srv);
            }
          }}
        >
          {srv.installType === 'direct' ? 'Install' : 'Config'}
        </Button>
      </div>
    </Card>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Server'}
        </Button>
      </div>

      {showForm && (
        <div className="border-border bg-surface-elevated mb-4 rounded-lg border p-4">
          <div className="space-y-3">
            <div>
              <label className="text-content-tertiary mb-1 block text-xs">Server Name</label>
              <input
                type="text"
                placeholder="e.g. filesystem"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-content-tertiary mb-1 block text-xs">Transport</label>
              <select
                value={form.transportType}
                onChange={(e) =>
                  setForm((p) => ({ ...p, transportType: e.target.value as 'stdio' | 'sse' }))
                }
                className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
              >
                <option value="stdio">stdio (local process)</option>
                <option value="sse">SSE (remote server)</option>
              </select>
            </div>
            {form.transportType === 'stdio' ? (
              <>
                <div>
                  <label className="text-content-tertiary mb-1 block text-xs">Command</label>
                  <input
                    type="text"
                    placeholder="npx"
                    value={form.command}
                    onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                    className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-content-tertiary mb-1 block text-xs">
                    Arguments (space-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="-y @anthropic/mcp-server-filesystem /path"
                    value={form.args}
                    onChange={(e) => setForm((p) => ({ ...p, args: e.target.value }))}
                    className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="text-content-tertiary mb-1 block text-xs">Server URL</label>
                <input
                  type="text"
                  placeholder="https://mcp.example.com/sse"
                  value={form.url}
                  onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                  className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
                />
              </div>
            )}
            <Button
              size="sm"
              fullWidth
              onClick={handleAdd}
              disabled={
                !form.name.trim() ||
                (form.transportType === 'sse' ? !form.url.trim() : !form.command.trim())
              }
            >
              Add MCP Server
            </Button>
          </div>
        </div>
      )}

      {testResult && (
        <div className="bg-intent-success-muted text-intent-success mb-3 rounded-sm px-3 py-2 text-sm">
          {testResult}
        </div>
      )}

      {servers.length === 0 ? (
        <p className="text-content-tertiary py-4 text-sm">No MCP servers configured.</p>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <Card key={s.name} padding="sm" className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-content-primary text-sm font-medium">{s.name}</span>
                  <Tag variant={s.enabled ? 'success' : 'default'}>
                    {s.enabled ? 'enabled' : 'disabled'}
                  </Tag>
                  {s.status && (
                    <Tag variant={s.status === 'connected' ? 'info' : 'danger'}>{s.status}</Tag>
                  )}
                </div>
                <p className="text-content-tertiary mt-0.5 font-mono text-xs">
                  {s.transport.type === 'sse'
                    ? s.transport.url
                    : `${s.transport.command ?? ''} ${(s.transport.args ?? []).join(' ')}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="xs" onClick={() => handleTest(s.name)}>
                  Test
                </Button>
                <Button variant="ghost" size="xs" onClick={() => handleToggle(s.name)}>
                  {s.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-intent-danger"
                  onClick={() => handleRemove(s.name)}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Recommended Section */}
      {availableRecommended.length > 0 && (
        <div className="mt-8">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-content-primary text-sm font-semibold">Recommended</h3>
            <span className="text-content-tertiary text-xs">Official recommended MCP servers</span>
          </div>
          <div className="border-border mb-1 border-b" />

          <div className="grid grid-cols-3 gap-3">
            {availableRecommended.map(renderRecommendedCard)}
          </div>
        </div>
      )}

      {/* Install Modal */}
      <InstallModal
        server={installing}
        onInstall={handleInstallRecommended}
        onClose={() => setInstalling(null)}
      />
    </div>
  );
}
