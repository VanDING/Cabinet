import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';

interface AdaptiveMonitorConfig {
  enabled: boolean;
  explorationRate: number;
  lookbackDays: number;
  minSamplesPerZone: number;
  hardLimits: {
    smartZoneMin: number;
    criticalThresholdMax: number;
  };
}

export function MonitorTab() {
  const [cfg, setCfg] = useState<AdaptiveMonitorConfig>({
    enabled: false,
    explorationRate: 0.1,
    lookbackDays: 14,
    minSamplesPerZone: 20,
    hardLimits: { smartZoneMin: 0.3, criticalThresholdMax: 0.9 },
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/adaptive-monitor', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setCfg(d))
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await apiFetch('/api/settings/adaptive-monitor', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify(cfg),
    });
    setSaving(false);
  };

  return (
    <div>
      <h2 className="text-content-primary mb-4 text-lg font-semibold">Adaptive Monitor</h2>
      <div className="max-w-lg space-y-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg((p) => ({ ...p, enabled: e.target.checked }))}
            className="h-4 w-4"
          />
          <span className="text-content-secondary text-sm">Enable adaptive thresholds</span>
        </label>

        <div>
          <label className="text-content-secondary mb-1 block text-sm">
            Exploration Rate (0–1)
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.explorationRate}
            onChange={(e) => setCfg((p) => ({ ...p, explorationRate: parseFloat(e.target.value) }))}
            className="w-full"
          />
          <div className="text-content-tertiary text-xs">{cfg.explorationRate.toFixed(2)}</div>
        </div>

        <div>
          <label className="text-content-secondary mb-1 block text-sm">Lookback Days</label>
          <input
            type="number"
            min={1}
            max={90}
            value={cfg.lookbackDays}
            onChange={(e) => setCfg((p) => ({ ...p, lookbackDays: parseInt(e.target.value) || 1 }))}
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-content-secondary mb-1 block text-sm">Min Samples Per Zone</label>
          <input
            type="number"
            min={1}
            max={200}
            value={cfg.minSamplesPerZone}
            onChange={(e) =>
              setCfg((p) => ({ ...p, minSamplesPerZone: parseInt(e.target.value) || 1 }))
            }
            className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-content-secondary mb-1 block text-sm">Smart Zone Min</label>
            <input
              type="number"
              min={0.1}
              max={0.5}
              step={0.05}
              value={cfg.hardLimits.smartZoneMin}
              onChange={(e) =>
                setCfg((p) => ({
                  ...p,
                  hardLimits: { ...p.hardLimits, smartZoneMin: parseFloat(e.target.value) || 0.3 },
                }))
              }
              className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-content-secondary mb-1 block text-sm">
              Critical Threshold Max
            </label>
            <input
              type="number"
              min={0.7}
              max={0.95}
              step={0.05}
              value={cfg.hardLimits.criticalThresholdMax}
              onChange={(e) =>
                setCfg((p) => ({
                  ...p,
                  hardLimits: {
                    ...p.hardLimits,
                    criticalThresholdMax: parseFloat(e.target.value) || 0.9,
                  },
                }))
              }
              className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-accent text-content-inverse hover:bg-accent-hover rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Monitor Config'}
        </button>
      </div>
    </div>
  );
}
