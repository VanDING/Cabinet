import React, { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

// ── Skills Tab ──
interface SkillItem { id: string; name: string; description: string; kind: string; version: number; status: string; }

function SkillsTab() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', kind: 'tool', promptTemplate: '' });

  const fetchSkills = () => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then(r => r.json()).then(d => setSkills(d.skills ?? [])).catch(() => {});
  };

  useEffect(() => { fetchSkills(); }, []);

  const handleCreate = async () => {
    if (editingId) {
      await apiFetch(`/api/skills/${editingId}`, {
        method: 'PUT', headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
      setEditingId(null);
    } else {
      await apiFetch('/api/skills', {
        method: 'POST', headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
    }
    setShowForm(false);
    setFormData({ name: '', description: '', kind: 'tool', promptTemplate: '' });
    fetchSkills();
  };

  const handleEdit = (s: SkillItem) => {
    setEditingId(s.id);
    setFormData({ name: s.name, description: s.description, kind: s.kind, promptTemplate: '' });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/skills/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    fetchSkills();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Skills</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          {showForm ? 'Cancel' : '+ New Skill'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 border dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
          <div className="space-y-3">
            <input placeholder="Name" value={formData.name}
              onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            <textarea placeholder="Description" value={formData.description}
              onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} rows={2}
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            <div className="flex gap-3">
              <select value={formData.kind}
                onChange={e => setFormData(p => ({ ...p, kind: e.target.value }))}
                className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                <option value="tool">Tool</option>
                <option value="prompt">Prompt</option>
                <option value="composite">Composite</option>
              </select>
              <input placeholder="Prompt Template" value={formData.promptTemplate}
                onChange={e => setFormData(p => ({ ...p, promptTemplate: e.target.value }))}
                className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>
            <button onClick={handleCreate} disabled={!formData.name.trim()}
              className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {editingId ? 'Save Changes' : 'Register Skill'}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No skills registered yet.</p>
      ) : (
        <div className="space-y-2">
          {skills.map(s => (
            <div key={s.id} className="group flex items-center justify-between border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{s.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.kind === 'tool' ? 'bg-blue-100 text-blue-700' : s.kind === 'prompt' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>{s.kind}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(s)}
                  className="text-xs text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1">Edit</button>
                <button onClick={() => handleDelete(s.id)}
                  className="text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1">Del</button>
                <span className="text-xs text-gray-400">v{s.version}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── API Keys Tab ──
interface ApiKeyItem {
  id: string;
  provider: string;
  baseUrl?: string;
  model?: string;
  keyPreview: string;
  encrypted: string;
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'claude-sonnet-4-6',
  });

  const fetchKeys = () => {
    apiFetch('/api/settings/api-keys', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setKeys(d.keys ?? []))
      .catch(() => {});
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleAdd = async () => {
    try {
      const res = await apiFetch('/api/settings/api-keys', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to add key' }));
        alert(err.message ?? 'Failed to add API key');
        return;
      }
      setShowForm(false);
      setFormData({ provider: 'anthropic', baseUrl: '', apiKey: '', model: '' });
      fetchKeys();
    } catch (e) {
      alert(`Failed to add API key: ${(e as Error).message}`);
    }
  };

  const handleRemove = async (id: string) => {
    await apiFetch(`/api/settings/api-keys/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    fetchKeys(); // Refresh list after removing
  };

  const providerModels: Record<string, string[]> = {
    anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    google: ['gemini-2.0-flash', 'gemini-2.0-pro'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1'],
    qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    zhipu: ['glm-4', 'glm-4-flash'],
    baichuan: ['baichuan4', 'baichuan3-turbo'],
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          {showForm ? 'Cancel' : '+ Add Key'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 border dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Provider</label>
              <select value={formData.provider}
                onChange={e => setFormData(p => ({ ...p, provider: e.target.value, model: providerModels[e.target.value]?.[0] ?? '' }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen (通义千问)</option>
                <option value="moonshot">Moonshot (月之暗面)</option>
                <option value="zhipu">Zhipu (智谱GLM)</option>
                <option value="baichuan">Baichuan (百川)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base URL (optional)</label>
              <input type="text" placeholder="https://api.anthropic.com" value={formData.baseUrl}
                onChange={e => setFormData(p => ({ ...p, baseUrl: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input type="password" placeholder="sk-ant-..." value={formData.apiKey}
                onChange={e => setFormData(p => ({ ...p, apiKey: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input type="text" placeholder="e.g. claude-sonnet-4-6" value={formData.model}
                onChange={e => setFormData(p => ({ ...p, model: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>
            <button onClick={handleAdd} disabled={!formData.apiKey.trim()}
              className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Add Key (AES-256 Encrypted)
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No API keys configured. Add keys to enable LLM features.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className="flex items-center justify-between border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100 capitalize">{k.provider}</span>
                  {k.model && <span className="text-xs text-gray-400 font-mono">{k.model}</span>}
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{k.keyPreview}</p>
              </div>
              <button onClick={() => handleRemove(k.id)} className="text-xs text-red-500 hover:underline">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Test Connection */}
      {keys.length > 0 && <TestConnectionButton />}
    </div>
  );
}

function TestConnectionButton() {
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<{ latencyMs: number; model: string; tokens: any } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTest = async () => {
    setStatus('testing');
    setResult(null);
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/secretary/verify', { headers: authHeaders() });
      const data = await res.json();
      if (data.status === 'ok') {
        setResult({ latencyMs: data.latency_ms, model: data.model, tokens: data.tokens });
        setStatus('ok');
      } else {
        setErrorMsg(data.message ?? 'Connection failed');
        setStatus('error');
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
      setStatus('error');
    }
  };

  return (
    <div className="mt-4 border-t dark:border-gray-700 pt-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={status === 'testing'}
          className="px-3 py-1.5 text-sm rounded-lg border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {status === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        {status === 'ok' && result && (
          <span className="text-sm text-green-600 dark:text-green-400">
            OK — {result.latencyMs}ms · {result.model} · {(result.tokens?.promptTokens ?? 0) + (result.tokens?.completionTokens ?? 0)} tokens
          </span>
        )}
        {status === 'error' && (
          <span className="text-sm text-red-500">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}

// ── Budget Tab ──
function BudgetTab() {
  const [budget, setBudget] = useState({ daily: 5, weekly: 25, monthly: 100 });

  useEffect(() => {
    apiFetch('/api/settings/budget', { headers: authHeaders() })
      .then(r => r.json()).then(d => setBudget(d)).catch(() => {});
  }, []);

  const handleSave = async () => {
    await apiFetch('/api/settings/budget', {
      method: 'PUT', headers: authJsonHeaders(),
      body: JSON.stringify(budget),
    });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Budget</h2>
      <div className="space-y-4 max-w-md">
        {['daily', 'weekly', 'monthly'].map(period => (
          <div key={period}>
            <label className="block text-sm text-gray-600 dark:text-gray-400 capitalize mb-1">{period} Budget (USD)</label>
            <input type="number" value={(budget as any)[period]}
              onChange={e => setBudget(p => ({ ...p, [period]: parseFloat(e.target.value) || 0 }))}
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          </div>
        ))}
        <button onClick={handleSave}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Save Budget</button>
      </div>
    </div>
  );
}

// ── Theme Tab ──
function ThemeTab() {
  const [pin, setPin] = useState('');
  const [pinStatus, setPinStatus] = useState<string | null>(null);

  const handleChangePin = async () => {
    if (pin.length < 4 || pin.length > 8) {
      setPinStatus('PIN must be 4-8 characters');
      return;
    }
    try {
      await apiFetch('/api/auth/pin', {
        method: 'PUT', headers: authJsonHeaders(),
        body: JSON.stringify({ pin }),
      });
      setPinStatus('PIN updated successfully');
      setPin('');
      localStorage.setItem('cabinet-pin', pin);
    } catch {
      setPinStatus('Failed to update PIN');
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Theme & Account</h2>
      <div className="space-y-4 max-w-md">
        <div className="flex items-center justify-between border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <div>
            <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Dark Mode</div>
            <div className="text-xs text-gray-500">Toggle between light and dark theme</div>
          </div>
          <button id="theme-toggle-btn"
            className="px-3 py-1.5 text-sm border dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              const isDark = document.documentElement.classList.toggle('dark');
              localStorage.setItem('cabinet-theme', isDark ? 'dark' : 'light');
            }}>
            Toggle
          </button>
        </div>

        <div className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-3">Change PIN</div>
          <div className="flex gap-2">
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} maxLength={8} placeholder="New PIN (4-8 digits)"
              className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <button onClick={handleChangePin} disabled={pin.length < 4}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">Update</button>
          </div>
          {pinStatus && <p className={`text-xs mt-2 ${pinStatus.includes('success') ? 'text-green-600' : 'text-red-500'}`}>{pinStatus}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Backups Tab ──
interface BackupItem {
  path: string; size: number; createdAt?: string;
}

function BackupsTab() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchBackups = () => {
    apiFetch('/api/backups', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setBackups(d.backups ?? []))
      .catch(() => {});
  };

  useEffect(() => { fetchBackups(); }, []);

  const handleCreate = async () => {
    setStatus('Creating backup...');
    try {
      const r = await apiFetch('/api/backups', {
        method: 'POST', headers: authHeaders(),
      });
      const d = await r.json();
      setStatus(d.path ? `Backup created: ${d.path}` : 'Backup failed');
      fetchBackups();
    } catch {
      setStatus('Backup failed');
    }
  };

  const handleRestore = async (path: string) => {
    if (!confirm(`Restore database from ${path}? This will overwrite current data.`)) return;
    setRestoring(true);
    try {
      await apiFetch('/api/backups/restore', {
        method: 'POST', headers: authJsonHeaders(),
        body: JSON.stringify({ path }),
      });
      setStatus('Database restored. Some changes may require a restart.');
    } catch {
      setStatus('Restore failed');
    }
    setRestoring(false);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backups</h2>
        <button onClick={handleCreate}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + Create Backup
        </button>
      </div>

      {status && (
        <div className={`mb-3 text-sm px-3 py-2 rounded ${status.includes('fail') || status.includes('Failed') ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300'}`}>
          {status}
        </div>
      )}

      {backups.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No backups yet. Create your first backup to protect your data.</p>
      ) : (
        <div className="space-y-2">
          {backups.map((b, i) => (
            <div key={i} className="flex items-center justify-between border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100 font-mono">{b.path}</div>
                <div className="text-xs text-gray-500">
                  {formatSize(b.size)}
                  {b.createdAt && ` · ${new Date(b.createdAt).toLocaleString()}`}
                </div>
              </div>
              <button onClick={() => handleRestore(b.path)} disabled={restoring}
                className="text-xs text-amber-600 hover:text-amber-700 disabled:opacity-50 px-2 py-1 border border-amber-300 rounded">
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Maintenance Tab (Garbage Collection) ──
interface GCIssueItem {
  category: string; severity: string; description: string;
  location: string; suggestedFix?: string; autoFixable: boolean;
}

function MaintenanceTab() {
  const [scanning, setScanning] = useState(false);
  const [lastReport, setLastReport] = useState<any>(null);
  const [issues, setIssues] = useState<GCIssueItem[]>([]);
  const [summary, setSummary] = useState<string>('');

  const handleScan = async () => {
    setScanning(true);
    setSummary('');
    try {
      const r = await apiFetch('/api/gc/scan', {
        method: 'POST', headers: authJsonHeaders(),
        body: JSON.stringify({ autoFix: false }),
      });
      const d = await r.json();
      setLastReport(d.report);
      setIssues(d.report?.issues ?? []);
      setSummary(d.summary ?? '');
    } catch (e) {
      setSummary(`Scan failed: ${(e as Error).message}`);
    }
    setScanning(false);
  };

  const severityColor = (s: string) =>
    s === 'error' ? 'text-red-600 bg-red-50 dark:bg-red-900 dark:text-red-300' :
    s === 'warning' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900 dark:text-amber-300' :
    'text-blue-600 bg-blue-50 dark:bg-blue-900 dark:text-blue-300';

  const categoryLabel = (c: string) =>
    c === 'orphan_file' ? 'Orphan File' :
    c === 'dead_code' ? 'Dead Code' :
    c === 'doc_drift' ? 'Doc Drift' :
    c === 'expired_data' ? 'Expired Data' :
    c === 'duplicate' ? 'Duplicate' : c;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">System Maintenance</h2>
        <button onClick={handleScan} disabled={scanning}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {scanning ? 'Scanning...' : 'Run GC Scan'}
        </button>
      </div>

      {lastReport && (
        <div className="mb-4 flex gap-4">
          <div className="flex-1 border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{lastReport.summary?.total ?? 0}</div>
            <div className="text-xs text-gray-500">Total Issues</div>
          </div>
          <div className="flex-1 border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-red-600">{lastReport.summary?.errors ?? 0}</div>
            <div className="text-xs text-gray-500">Errors</div>
          </div>
          <div className="flex-1 border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-amber-600">{lastReport.summary?.warnings ?? 0}</div>
            <div className="text-xs text-gray-500">Warnings</div>
          </div>
          <div className="flex-1 border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
            <div className="text-2xl font-bold text-gray-500">{lastReport.filesScanned ?? 0}</div>
            <div className="text-xs text-gray-500">Files Scanned</div>
          </div>
        </div>
      )}

      {summary && (
        <div className="mb-4 p-4 border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">{summary}</pre>
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-2">
          {issues.slice(0, 20).map((issue, i) => (
            <div key={i} className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severityColor(issue.severity)}`}>
                  {issue.severity.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">{categoryLabel(issue.category)}</span>
                {issue.autoFixable && <span className="text-xs text-green-600">auto-fixable</span>}
              </div>
              <p className="text-sm text-gray-900 dark:text-gray-100">{issue.description}</p>
              <p className="text-xs text-gray-400 mt-1 font-mono">{issue.location}</p>
              {issue.suggestedFix && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Fix: {issue.suggestedFix}</p>
              )}
            </div>
          ))}
          {issues.length > 20 && (
            <p className="text-xs text-gray-500 text-center py-2">... and {issues.length - 20} more issues</p>
          )}
        </div>
      )}

      {!lastReport && !scanning && (
        <p className="text-gray-400 text-sm py-4">Run a garbage collection scan to detect dead code, orphan files, expired data, and documentation drift.</p>
      )}
    </div>
  );
}

// ── Delegation Tab ──
function DelegationTab() {
  const [tier, setTier] = useState('');
  const [available, setAvailable] = useState<{ id: string; label: string; description: string }[]>([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/delegation-tier', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        setTier(data.tier);
        setDescription(data.description);
        setAvailable(data.available ?? []);
      })
      .catch(() => {});
  }, []);

  const handleChange = async (newTier: string) => {
    setLoading(true);
    try {
      await apiFetch('/api/settings/delegation-tier', {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ tier: newTier }),
      });
      setTier(newTier);
      const match = available.find(t => t.id === newTier);
      if (match) setDescription(match.description);
    } catch {}
    setLoading(false);
  };

  const tierLabel = (t: string) => {
    switch (t) {
      case 'T0': return 'Captain Review';
      case 'T1': return 'Strategic Guard';
      case 'T2': return 'Trusted Mode';
      case 'T3': return 'Full Autonomy';
      default: return t;
    }
  };

  const tierColor = (t: string) => {
    switch (t) {
      case 'T0': return 'border-red-400 bg-red-50 dark:bg-red-900/20';
      case 'T1': return 'border-amber-400 bg-amber-50 dark:bg-amber-900/20';
      case 'T2': return 'border-blue-400 bg-blue-50 dark:bg-blue-900/20';
      case 'T3': return 'border-green-400 bg-green-50 dark:bg-green-900/20';
      default: return 'border-gray-200 dark:border-gray-600';
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delegation Tier</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Control how much autonomy Cabinet has before requiring your confirmation.
      </p>

      {/* Current tier description */}
      <div className={`border rounded-lg p-4 mb-4 ${tierColor(tier)}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono font-bold text-gray-500">{tier}</span>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{tierLabel(tier)}</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      {/* Tier selector */}
      <div className="space-y-3">
        {available.map(t => (
          <button
            key={t.id}
            onClick={() => handleChange(t.id)}
            disabled={loading || t.id === tier}
            className={`w-full text-left border rounded-lg p-3 transition-all ${
              t.id === tier
                ? 'ring-2 ring-blue-500 border-blue-500 cursor-default'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer'
            } ${loading ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold text-gray-500">{t.id}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.label}</span>
              {t.id === tier && (
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Active</span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Blocked tools info */}
      <div className="mt-4 p-3 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          What's blocked at {tierLabel(tier)}:
        </p>
        <ul className="text-xs text-gray-500 dark:text-gray-400 list-disc list-inside space-y-0.5">
          {tier === 'T0' && (
            <>All write operations are blocked. Only read-only queries are allowed.</>
          )}
          {tier === 'T1' && (
            <>
              <li>Approve/reject decisions</li>
              <li>Run workflows (costs LLM credits)</li>
              <li>Start meetings (costs LLM credits)</li>
              <li>Delete workflows</li>
            </>
          )}
          {tier === 'T2' && (
            <>
              <li>Delete workflows</li>
              <li>Reject decisions</li>
            </>
          )}
          {tier === 'T3' && (
            <>Nothing is blocked. Budget cap is the only safety gate.</>
          )}
        </ul>
      </div>
    </div>
  );
}

// ── Audit Log Tab ──
function AuditTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ entityType: '', limit: 50 });

  const fetchAudit = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(filter.limit) });
    if (filter.entityType) params.set('entityType', filter.entityType);

    apiFetch(`/api/audit?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAudit(); }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Audit Log</h2>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={filter.entityType}
          onChange={e => { setFilter(p => ({ ...p, entityType: e.target.value })); }}
          className="border dark:border-gray-600 rounded px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="">All types</option>
          <option value="decision">Decision</option>
          <option value="meeting">Meeting</option>
          <option value="workflow">Workflow</option>
          <option value="employee">Employee</option>
          <option value="skill">Skill</option>
        </select>
        <button onClick={fetchAudit}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-400">No audit entries found.</p>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {entries.map((e: any, i: number) => (
            <div key={i} className="flex items-center gap-3 text-xs border-b dark:border-gray-700 py-2">
              <span className="text-gray-400 w-14 flex-shrink-0">
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="px-1.5 py-0.5 rounded font-medium capitalize w-16 text-center flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                {e.action}
              </span>
              <span className="text-gray-400 w-12 flex-shrink-0">{e.entityType}</span>
              <span className="text-gray-500 font-mono truncate flex-1">{e.entityId}</span>
              <span className="text-gray-400">{e.actor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Rules Tab ──
interface RuleItem {
  filename: string; path: string; description: string;
  globs: string[]; alwaysApply: boolean; tags: string[];
  content: string; mode: string;
}

function RulesTab() {
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const fetchRules = () => {
    apiFetch('/api/rules', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setRules(d.rules ?? []))
      .catch(() => {});
  };

  useEffect(() => { fetchRules(); }, []);

  const handleEdit = (rule: RuleItem) => {
    setEditingFile(rule.filename);
    setEditContent(rule.content);
    setStatus(null);
  };

  const handleSave = async (filename: string) => {
    try {
      await apiFetch(`/api/rules/${filename}`, {
        method: 'PUT', headers: authJsonHeaders(),
        body: JSON.stringify({ content: editContent }),
      });
      setStatus(`Saved ${filename}`);
      setEditingFile(null);
      fetchRules();
    } catch {
      setStatus('Save failed');
    }
  };

  const modeColor = (mode: string) =>
    mode === 'always' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
    mode === 'auto' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Project Rules</h2>
      <p className="text-xs text-gray-500 mb-4">
        Rules are loaded from <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">.cabinet/rules/</code>.
        Each file has YAML frontmatter controlling when it activates.
      </p>

      {status && (
        <div className={`mb-3 text-sm px-3 py-2 rounded ${status.includes('fail') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {status}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No rules found. Create .md files in .cabinet/rules/ to define project conventions.</p>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule.filename} className="border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
              <div className="flex items-center justify-between p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100 font-mono">{rule.filename}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${modeColor(rule.mode)}`}>
                      {rule.mode}
                    </span>
                    {rule.alwaysApply && <span className="text-xs text-green-600">alwaysApply</span>}
                  </div>
                  {rule.description && <p className="text-xs text-gray-500">{rule.description}</p>}
                  <div className="flex gap-2 mt-1">
                    {rule.globs.map(g => (
                      <span key={g} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded font-mono">{g}</span>
                    ))}
                    {rule.tags.map(t => (
                      <span key={t} className="text-xs text-blue-500">#{t}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => editingFile === rule.filename ? setEditingFile(null) : handleEdit(rule)}
                  className="text-xs text-blue-500 hover:underline flex-shrink-0 ml-3">
                  {editingFile === rule.filename ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {editingFile === rule.filename && (
                <div className="border-t dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={12}
                    className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                  />
                  <div className="flex justify-end mt-2">
                    <button onClick={() => handleSave(rule.filename)}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ──
type SettingsTab = 'api-keys' | 'budget' | 'delegation' | 'audit' | 'backups' | 'maintenance' | 'rules' | 'skills';

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'api-keys', label: 'API Keys', icon: '\u{1F511}' },
  { id: 'budget', label: 'Budget', icon: '\u{1F4B0}' },
  { id: 'delegation', label: 'Delegation', icon: '\u{1F6E1}' },
  { id: 'audit', label: 'Audit Log', icon: '\u{1F4CB}' },
  { id: 'backups', label: 'Backups', icon: '\u{1F4BE}' },
  { id: 'maintenance', label: 'Maintenance', icon: '\u{1F9F9}' },
  { id: 'rules', label: 'Rules', icon: '\u{1F4DC}' },
  { id: 'skills', label: 'Skills', icon: '\u{1F9E9}' },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('api-keys');

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Settings</h1>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 border-b dark:border-gray-700">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'skills' && <SkillsTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'budget' && <BudgetTab />}
      {activeTab === 'delegation' && <DelegationTab />}
      {activeTab === 'audit' && <AuditTab />}
      {activeTab === 'backups' && <BackupsTab />}
      {activeTab === 'maintenance' && <MaintenanceTab />}
      {activeTab === 'rules' && <RulesTab />}
    </div>
  );
}
