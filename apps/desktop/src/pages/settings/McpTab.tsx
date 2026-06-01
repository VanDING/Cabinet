import { useState, useEffect } from 'react';
import { Button, Input, Card, Tag } from '@cabinet/ui';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

interface MCPServer {
  name: string;
  transport: string;
  command: string;
  args: string[];
  enabled: boolean;
  status?: string;
  toolCount?: number;
}

export function McpTab() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', command: 'npx', args: '', enabled: true });

  const fetchServers = () => {
    apiFetch('/api/settings/mcp-servers', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const configs: MCPServer[] = (d.configs ?? []);
        const statuses = d.servers ?? [];
        const merged = configs.map((c) => {
          const s = statuses.find((st: { name: string }) => st.name === c.name);
          return {
            ...c,
            args: c.args ?? [],
            status: s?.connected ? 'connected' : 'disconnected',
            toolCount: s?.toolCount ?? 0,
          };
        });
        setServers(merged);
      })
      .catch((err) => { console.warn('Operation failed', err); });
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    const newServer: MCPServer = {
      name: form.name.trim(),
      transport: 'stdio',
      command: form.command.trim(),
      args: form.args.split(/\s+/).filter(Boolean),
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
        setForm({ name: '', command: 'npx', args: '', enabled: true });
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
      if (d.status === 'connected') {
        setTestResult(`${name}: Connected — ${d.toolCount} tools available`);
      } else {
        setTestResult(`${name}: ${d.error ?? 'Connection failed'}`);
      }
    } catch (e) {
      setTestResult(`${name}: ${(e as Error).message}`);
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-content-primary">MCP Servers</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Server'}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border border-border bg-surface-elevated p-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">Server Name</label>
              <input
                type="text"
                placeholder="e.g. filesystem"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">Command</label>
              <input
                type="text"
                placeholder="npx"
                value={form.command}
                onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">
                Arguments (space-separated)
              </label>
              <input
                type="text"
                placeholder="-y @anthropic/mcp-server-filesystem /path"
                value={form.args}
                onChange={(e) => setForm((p) => ({ ...p, args: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <Button
              size="sm"
              fullWidth
              onClick={handleAdd}
              disabled={!form.name.trim() || !form.command.trim()}
            >
              Add MCP Server
            </Button>
          </div>
        </div>
      )}

      {testResult && (
        <div className="mb-3 rounded-sm bg-intent-success-muted px-3 py-2 text-sm text-intent-success">
          {testResult}
        </div>
      )}

      {servers.length === 0 ? (
        <p className="py-4 text-sm text-content-tertiary">
          No MCP servers configured. Add MCP servers to extend AI capabilities with custom tools.
        </p>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <Card key={s.name} padding="sm" className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content-primary">
                    {s.name}
                  </span>
                  <Tag variant={s.enabled ? 'success' : 'default'}>
                    {s.enabled ? 'enabled' : 'disabled'}
                  </Tag>
                  {s.status && (
                    <Tag variant={s.status === 'connected' ? 'info' : 'danger'}>
                      {s.status}
                    </Tag>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-xs text-content-tertiary">
                  {s.command} {(s.args ?? []).join(' ')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="xs" onClick={() => handleTest(s.name)}>
                  Test
                </Button>
                <Button variant="ghost" size="xs" onClick={() => handleToggle(s.name)}>
                  {s.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="ghost" size="xs" className="text-intent-danger" onClick={() => handleRemove(s.name)}>
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
