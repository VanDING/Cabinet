import { useState, useEffect } from 'react';
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
      .then((d) => setServers(d.servers ?? []))
      .catch(() => {});
  };

  useEffect(() => { fetchServers(); }, []);

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
    } catch { /* ignore */ }
  };

  const handleToggle = async (name: string) => {
    const updated = servers.map((s) =>
      s.name === name ? { ...s, enabled: !s.enabled } : s,
    );
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">MCP Servers</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Server'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Server Name</label>
              <input
                type="text"
                placeholder="e.g. filesystem"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Command</label>
              <input
                type="text"
                placeholder="npx"
                value={form.command}
                onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Arguments (space-separated)</label>
              <input
                type="text"
                placeholder="-y @anthropic/mcp-server-filesystem /path"
                value={form.args}
                onChange={(e) => setForm((p) => ({ ...p, args: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!form.name.trim() || !form.command.trim()}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add MCP Server
            </button>
          </div>
        </div>
      )}

      {testResult && (
        <div className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900 dark:text-green-300">
          {testResult}
        </div>
      )}

      {servers.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">
          No MCP servers configured. Add MCP servers to extend AI capabilities with custom tools.
        </p>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${s.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-500'}`}>
                    {s.enabled ? 'enabled' : 'disabled'}
                  </span>
                  {s.status && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs ${s.status === 'connected' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                      {s.status}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-xs text-gray-400">
                  {s.command} {s.args.join(' ')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTest(s.name)}
                  className="rounded border px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Test
                </button>
                <button
                  onClick={() => handleToggle(s.name)}
                  className="rounded border px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleRemove(s.name)}
                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
