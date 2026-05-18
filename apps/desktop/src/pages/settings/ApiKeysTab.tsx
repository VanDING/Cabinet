import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';
import { PROVIDER_MODELS } from '../../hooks/useAvailableModels.js';
import { useToast } from '../../components/Toast.js';

// ── API Keys Tab ──
interface ApiKeyItem {
  id: string;
  provider: string;
  baseUrl?: string;
  model?: string;
  keyPreview: string;
  encrypted: string;
}

export function ApiKeysTab() {
  const { addToast } = useToast();
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
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleAdd = async () => {
    try {
      const res = await apiFetch('/api/settings/api-keys', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to add key' }));
        addToast('error', err.message ?? 'Failed to add API key');
        return;
      }
      setShowForm(false);
      setFormData({ provider: 'anthropic', baseUrl: '', apiKey: '', model: '' });
      fetchKeys();
      window.dispatchEvent(new CustomEvent('apikeys_changed'));
    } catch (e) {
      addToast('error', `Failed to add API key: ${(e as Error).message}`);
    }
  };

  const handleRemove = async (id: string) => {
    await apiFetch(`/api/settings/api-keys/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    fetchKeys();
    window.dispatchEvent(new CustomEvent('apikeys_changed'));
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Key'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Provider</label>
              <select
                value={formData.provider}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    provider: e.target.value,
                    model: PROVIDER_MODELS[e.target.value]?.[0] ?? '',
                  }))
                }
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
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
              <label className="mb-1 block text-xs text-gray-500">Base URL (optional)</label>
              <input
                type="text"
                placeholder="https://api.anthropic.com"
                value={formData.baseUrl}
                onChange={(e) => setFormData((p) => ({ ...p, baseUrl: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">API Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={formData.apiKey}
                onChange={(e) => setFormData((p) => ({ ...p, apiKey: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Model</label>
              <input
                type="text"
                placeholder="e.g. claude-sonnet-4-6"
                value={formData.model}
                onChange={(e) => setFormData((p) => ({ ...p, model: e.target.value }))}
                className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!formData.apiKey.trim()}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add Key (AES-256 Encrypted)
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">
          No API keys configured. Add keys to enable LLM features.
        </p>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize text-gray-900 dark:text-gray-100">
                    {k.provider}
                  </span>
                  {k.model && <span className="font-mono text-xs text-gray-400">{k.model}</span>}
                </div>
                <p className="mt-0.5 font-mono text-xs text-gray-400">{k.keyPreview}</p>
              </div>
              <button
                onClick={() => handleRemove(k.id)}
                className="text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Test Connection */}
      {keys.length > 0 && <TestConnectionButton />}

      {/* Budget Section */}
      <BudgetSection />
    </div>
  );
}

function BudgetSection() {
  const [budget, setBudget] = useState({ daily: 5, weekly: 25, monthly: 100 });
  const [currentSpend, setCurrentSpend] = useState(0);

  useEffect(() => {
    apiFetch('/api/settings/budget', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setBudget({ daily: d.daily ?? 5, weekly: d.weekly ?? 25, monthly: d.monthly ?? 100 });
        setCurrentSpend(d.currentSpend ?? 0);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    await apiFetch('/api/settings/budget', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify(budget),
    });
  };

  return (
    <div className="mt-6 border-t pt-6 dark:border-gray-700">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">Budget Limits</h3>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-gray-500">Today's spend:</span>
        <span className="font-medium text-blue-600">${currentSpend.toFixed(4)}</span>
      </div>
      <div className="grid grid-cols-3 gap-4 max-w-lg">
        {['daily', 'weekly', 'monthly'].map((period) => (
          <div key={period}>
            <label className="block text-sm capitalize text-gray-600 dark:text-gray-400 mb-1">
              {period}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">$</span>
              <input
                type="number"
                value={(budget as any)[period]}
                onChange={(e) =>
                  setBudget((p) => ({ ...p, [period]: parseFloat(e.target.value) || 0 }))
                }
                className="w-24 rounded border bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={handleSave}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
      >
        Save Budget
      </button>
    </div>
  );
}

function TestConnectionButton() {
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<{ latencyMs: number; model: string; tokens: any } | null>(
    null,
  );
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
    <div className="mt-4 border-t pt-4 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={status === 'testing'}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          {status === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        {status === 'ok' && result && (
          <span className="text-sm text-green-600 dark:text-green-400">
            OK — {result.latencyMs}ms · {result.model} ·{' '}
            {(result.tokens?.promptTokens ?? 0) + (result.tokens?.completionTokens ?? 0)} tokens
          </span>
        )}
        {status === 'error' && <span className="text-sm text-red-500">{errorMsg}</span>}
      </div>
    </div>
  );
}
