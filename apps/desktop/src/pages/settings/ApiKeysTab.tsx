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
            <ApiKeyRow key={k.id} item={k} onRemove={handleRemove} />
          ))}
        </div>
      )}

      {/* Model Mapping Section */}
      <ModelMappingSection />

      {/* Budget Section */}
      <BudgetSection />
    </div>
  );
}

function ApiKeyRow({ item, onRemove }: { item: ApiKeyItem; onRemove: (id: string) => void }) {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testResult, setTestResult] = useState<{
    latencyMs?: number;
    model?: string;
    message?: string;
  } | null>(null);

  const handleTest = async () => {
    setTestStatus('testing');
    setTestResult(null);
    try {
      const res = await apiFetch(`/api/settings/api-keys/${item.id}/test`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        setTestResult({ latencyMs: data.latency_ms, model: data.model });
        setTestStatus('ok');
      } else {
        setTestResult({ message: data.message ?? 'Connection failed' });
        setTestStatus('error');
      }
    } catch (e) {
      setTestResult({ message: (e as Error).message });
      setTestStatus('error');
    }
  };

  return (
    <div className="flex items-center justify-between rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-gray-900 dark:text-gray-100">
            {item.provider}
          </span>
          {item.model && <span className="font-mono text-xs text-gray-400">{item.model}</span>}
        </div>
        <p className="mt-0.5 font-mono text-xs text-gray-400">{item.keyPreview}</p>
        {testStatus === 'ok' && testResult && (
          <p className="mt-1 text-xs text-green-600 dark:text-green-400">
            OK — {testResult.latencyMs}ms · {testResult.model}
          </p>
        )}
        {testStatus === 'error' && testResult && (
          <p className="mt-1 text-xs text-red-500">{testResult.message}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testStatus === 'testing'}
          className="rounded border px-2 py-1 text-xs transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          {testStatus === 'testing' ? 'Testing...' : 'Test'}
        </button>
        <button onClick={() => onRemove(item.id)} className="text-xs text-red-500 hover:underline">
          Remove
        </button>
      </div>
    </div>
  );
}

function ModelMappingSection() {
  const { addToast } = useToast();
  const [mapping, setMapping] = useState({
    default: '',
    deep_reasoning: '',
    fast_execution: '',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/settings/model-config', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const m = d.modelMapping ?? {};
        setMapping({
          default: m.default ?? '',
          deep_reasoning: m.deep_reasoning ?? '',
          fast_execution: m.fast_execution ?? '',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    if (mapping.default.trim()) payload.default = mapping.default.trim();
    if (mapping.deep_reasoning.trim()) payload.deep_reasoning = mapping.deep_reasoning.trim();
    if (mapping.fast_execution.trim()) payload.fast_execution = mapping.fast_execution.trim();

    try {
      const res = await apiFetch('/api/settings/model-config', {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ modelMapping: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to save' }));
        addToast('error', err.message ?? 'Failed to save model mapping');
        return;
      }
      addToast('success', 'Model mapping saved');
      window.dispatchEvent(new CustomEvent('apikeys_changed'));
    } catch (e) {
      addToast('error', `Failed to save model mapping: ${(e as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="mt-6 border-t pt-6 dark:border-gray-700">
        <p className="text-sm text-gray-400">Loading model configuration...</p>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t pt-6 dark:border-gray-700">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        Model Mapping
      </h3>
      <p className="mb-3 text-xs text-gray-500">
        Leave empty to use automatic inference. Cross-provider mixing is supported, e.g.
        openai/gpt-4o, deepseek/deepseek-v4-flash.
      </p>
      <div className="max-w-lg space-y-3">
        <div>
          <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
            Default Model (default)
          </label>
          <input
            type="text"
            placeholder="e.g. openai/gpt-4o"
            value={mapping.default}
            onChange={(e) => setMapping((p) => ({ ...p, default: e.target.value }))}
            className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
            Deep Reasoning Model (deep_reasoning)
          </label>
          <input
            type="text"
            placeholder="e.g. anthropic/claude-opus-4-7"
            value={mapping.deep_reasoning}
            onChange={(e) => setMapping((p) => ({ ...p, deep_reasoning: e.target.value }))}
            className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
            Fast Execution Model (fast_execution)
          </label>
          <input
            type="text"
            placeholder="e.g. anthropic/claude-haiku-4-5"
            value={mapping.fast_execution}
            onChange={(e) => setMapping((p) => ({ ...p, fast_execution: e.target.value }))}
            className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
      >
        Save Model Mapping
      </button>
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
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        Budget Limits
      </h3>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-gray-500">Today's spend:</span>
        <span className="font-medium text-blue-600">${currentSpend.toFixed(4)}</span>
      </div>
      <div className="grid max-w-lg grid-cols-3 gap-4">
        {['daily', 'weekly', 'monthly'].map((period) => (
          <div key={period}>
            <label className="mb-1 block text-sm capitalize text-gray-600 dark:text-gray-400">
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
