import React, { useState, useEffect } from 'react';

// ── Skills Tab ──
interface SkillItem { id: string; name: string; description: string; kind: string; version: number; status: string; }

function SkillsTab() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', kind: 'tool', promptTemplate: '' });

  useEffect(() => {
    fetch('/api/skills', { headers: { 'x-cabinet-pin': '1234' } })
      .then(r => r.json()).then(d => setSkills(d.skills ?? [])).catch(() => {});
  }, []);

  const handleCreate = async () => {
    await fetch('/api/skills', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
      body: JSON.stringify(formData),
    });
    setShowForm(false);
    setFormData({ name: '', description: '', kind: 'tool', promptTemplate: '' });
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
              Register Skill
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No skills registered yet.</p>
      ) : (
        <div className="space-y-2">
          {skills.map(s => (
            <div key={s.id} className="flex items-center justify-between border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{s.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.kind === 'tool' ? 'bg-blue-100 text-blue-700' : s.kind === 'prompt' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>{s.kind}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
              </div>
              <span className="text-xs text-gray-400">v{s.version}</span>
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
    fetch('/api/settings/api-keys', { headers: { 'x-cabinet-pin': '1234' } })
      .then(r => r.json())
      .then(d => setKeys(d.keys ?? []))
      .catch(() => {});
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleAdd = async () => {
    await fetch('/api/settings/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
      body: JSON.stringify(formData),
    });
    setShowForm(false);
    setFormData({ provider: 'anthropic', baseUrl: '', apiKey: '', model: 'claude-sonnet-4-6' });
    fetchKeys(); // Refresh list after adding
  };

  const handleRemove = async (id: string) => {
    await fetch(`/api/settings/api-keys/${id}`, {
      method: 'DELETE',
      headers: { 'x-cabinet-pin': '1234' },
    });
    fetchKeys(); // Refresh list after removing
  };

  const providerModels: Record<string, string[]> = {
    anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    google: ['gemini-2.0-flash', 'gemini-2.0-pro'],
  };

  const models = providerModels[formData.provider] ?? [];

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
              <select value={formData.model}
                onChange={e => setFormData(p => ({ ...p, model: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
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
    </div>
  );
}

// ── Budget Tab ──
function BudgetTab() {
  const [budget, setBudget] = useState({ daily: 5, weekly: 25, monthly: 100 });

  useEffect(() => {
    fetch('/api/settings/budget', { headers: { 'x-cabinet-pin': '1234' } })
      .then(r => r.json()).then(d => setBudget(d)).catch(() => {});
  }, []);

  const handleSave = async () => {
    await fetch('/api/settings/budget', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
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
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Theme</h2>
      <div className="space-y-3 max-w-md">
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
      </div>
    </div>
  );
}

// ── Main Settings Page ──
type SettingsTab = 'skills' | 'api-keys' | 'budget' | 'theme';

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'skills', label: 'Skills', icon: '\u{1F9E9}' },
  { id: 'api-keys', label: 'API Keys', icon: '\u{1F511}' },
  { id: 'budget', label: 'Budget', icon: '\u{1F4B0}' },
  { id: 'theme', label: 'Theme', icon: '\u{1F3A8}' },
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
      {activeTab === 'theme' && <ThemeTab />}
    </div>
  );
}
