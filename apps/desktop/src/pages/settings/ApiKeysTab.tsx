import { useState, useEffect } from 'react';
import { Button, Input, Card, Tag } from '@cabinet/ui';
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
      .catch((err) => { console.warn('Operation failed', err); });
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
        <h2 className="text-lg font-semibold text-content-primary">API Keys</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Key'}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg border border-border bg-surface-elevated p-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">Provider</label>
              <select
                value={formData.provider}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    provider: e.target.value,
                    model: PROVIDER_MODELS[e.target.value]?.[0] ?? '',
                  }))
                }
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen</option>
                <option value="moonshot">Moonshot</option>
                <option value="zhipu">Zhipu</option>
                <option value="baichuan">Baichuan</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">Base URL (optional)</label>
              <input
                type="text"
                placeholder="https://api.anthropic.com"
                value={formData.baseUrl}
                onChange={(e) => setFormData((p) => ({ ...p, baseUrl: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">API Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={formData.apiKey}
                onChange={(e) => setFormData((p) => ({ ...p, apiKey: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-content-tertiary">Model</label>
              <input
                type="text"
                placeholder="e.g. claude-sonnet-4-6"
                value={formData.model}
                onChange={(e) => setFormData((p) => ({ ...p, model: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            </div>
            <Button size="sm" fullWidth onClick={handleAdd} disabled={!formData.apiKey.trim()}>
              Add Key (AES-256 Encrypted)
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="py-4 text-sm text-content-tertiary">
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
    <Card padding="sm" className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-content-primary">
            {item.provider}
          </span>
          {item.model && <span className="font-mono text-xs text-content-tertiary">{item.model}</span>}
        </div>
        <p className="mt-0.5 font-mono text-xs text-content-tertiary">{item.keyPreview}</p>
        {testStatus === 'ok' && testResult && (
          <p className="mt-1 text-xs text-intent-success">
            OK — {testResult.latencyMs}ms · {testResult.model}
          </p>
        )}
        {testStatus === 'error' && testResult && (
          <p className="mt-1 text-xs text-intent-danger">{testResult.message}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={handleTest}
          disabled={testStatus === 'testing'}
        >
          {testStatus === 'testing' ? 'Testing...' : 'Test'}
        </Button>
        <Button variant="ghost" size="xs" className="text-intent-danger" onClick={() => onRemove(item.id)}>
          Remove
        </Button>
      </div>
    </Card>
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
      .catch((err) => { console.warn('Operation failed', err); })
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
      <div className="mt-6 border-t border-border pt-6">
        <p className="text-sm text-content-tertiary">Loading model configuration...</p>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <h3 className="mb-3 text-base font-semibold text-content-primary">
        Model Mapping
      </h3>
      <p className="mb-3 text-xs text-content-tertiary">
        Leave empty to use automatic inference. Cross-provider mixing is supported, e.g.
        openai/gpt-4o, deepseek/deepseek-v4-flash.
      </p>
      <div className="max-w-lg space-y-3">
        <div>
          <label className="mb-1 block text-sm text-content-secondary">
            Default Model (default)
          </label>
          <input
            type="text"
            placeholder="e.g. openai/gpt-4o"
            value={mapping.default}
            onChange={(e) => setMapping((p) => ({ ...p, default: e.target.value }))}
            className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-content-secondary">
            Deep Reasoning Model (deep_reasoning)
          </label>
          <input
            type="text"
            placeholder="e.g. anthropic/claude-opus-4-7"
            value={mapping.deep_reasoning}
            onChange={(e) => setMapping((p) => ({ ...p, deep_reasoning: e.target.value }))}
            className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-content-secondary">
            Fast Execution Model (fast_execution)
          </label>
          <input
            type="text"
            placeholder="e.g. anthropic/claude-haiku-4-5"
            value={mapping.fast_execution}
            onChange={(e) => setMapping((p) => ({ ...p, fast_execution: e.target.value }))}
            className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
          />
        </div>
      </div>
      <Button size="sm" onClick={handleSave} className="mt-4">
        Save Model Mapping
      </Button>
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
      .catch((err) => { console.warn('Operation failed', err); });
  }, []);

  const handleSave = async () => {
    await apiFetch('/api/settings/budget', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify(budget),
    });
  };

  return (
    <div className="mt-6 border-t border-border pt-6">
      <h3 className="mb-3 text-base font-semibold text-content-primary">
        Budget Limits
      </h3>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-content-tertiary">Today's spend:</span>
        <span className="font-medium text-accent">${currentSpend.toFixed(4)}</span>
      </div>
      <div className="grid max-w-lg grid-cols-3 gap-4">
        {['daily', 'weekly', 'monthly'].map((period) => (
          <div key={period}>
            <label className="mb-1 block text-sm capitalize text-content-secondary">
              {period}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-content-tertiary">$</span>
              <input
                type="number"
                value={(budget as any)[period]}
                onChange={(e) =>
                  setBudget((p) => ({ ...p, [period]: parseFloat(e.target.value) || 0 }))
                }
                className="w-24 rounded-sm border border-border bg-surface-primary px-2 py-1.5 text-sm text-content-primary"
              />
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={handleSave} className="mt-4">
        Save Budget
      </Button>
    </div>
  );
}
