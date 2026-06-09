import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';

interface PISConfig {
  enabled: boolean;
  mode: 'log_only' | 'intervene';
  evaluationIntervalSteps: number;
  weights: {
    intentAlignment: number;
    toolCoherence: number;
    goalProgress: number;
    contextStability: number;
  };
}

export function PisTab() {
  const [cfg, setCfg] = useState<PISConfig>({
    enabled: false,
    mode: 'log_only',
    evaluationIntervalSteps: 3,
    weights: {
      intentAlignment: 0.35,
      toolCoherence: 0.25,
      goalProgress: 0.25,
      contextStability: 0.15,
    },
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/pis', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setCfg(d))
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await apiFetch('/api/settings/pis', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify(cfg),
    });
    setSaving(false);
  };

  return (
    <div>
      <h2 className="text-content-primary mb-4 text-lg font-semibold">
        Process Identity Score (PIS)
      </h2>
      <div className="max-w-lg space-y-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg((p) => ({ ...p, enabled: e.target.checked }))}
            className="h-4 w-4"
          />
          <span className="text-content-secondary text-sm">Enable PIS evaluation</span>
        </label>

        <div>
          <label className="text-content-secondary mb-1 block text-sm">Mode</label>
          <select
            value={cfg.mode}
            onChange={(e) =>
              setCfg((p) => ({ ...p, mode: e.target.value as 'log_only' | 'intervene' }))
            }
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          >
            <option value="log_only">Log Only (record, no intervention)</option>
            <option value="intervene">Intervene (emit alerts on drift)</option>
          </select>
        </div>

        <div>
          <label className="text-content-secondary mb-1 block text-sm">
            Evaluation Interval (steps)
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={cfg.evaluationIntervalSteps}
            onChange={(e) =>
              setCfg((p) => ({ ...p, evaluationIntervalSteps: parseInt(e.target.value) || 1 }))
            }
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-content-primary text-sm font-medium">Factor Weights</h3>
          {(
            [
              ['intentAlignment', 'Intent Alignment'],
              ['toolCoherence', 'Tool Coherence'],
              ['goalProgress', 'Goal Progress'],
              ['contextStability', 'Context Stability'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="text-content-secondary mb-1 block text-xs">{label}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cfg.weights[key]}
                onChange={(e) =>
                  setCfg((p) => ({
                    ...p,
                    weights: { ...p.weights, [key]: parseFloat(e.target.value) },
                  }))
                }
                className="w-full"
              />
              <div className="text-content-tertiary text-xs">
                {(cfg.weights[key] as number).toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-accent text-content-inverse hover:bg-accent-hover rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save PIS Config'}
        </button>
      </div>
    </div>
  );
}
