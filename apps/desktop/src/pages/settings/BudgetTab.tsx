import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

// ── Budget Tab ──
export function BudgetTab() {
  const [budget, setBudget] = useState({ daily: 5, weekly: 25, monthly: 100 });

  useEffect(() => {
    apiFetch('/api/settings/budget', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBudget(d))
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
    <div>
      <h2 className="mb-4 text-lg font-semibold text-content-primary">Budget</h2>
      <div className="max-w-md space-y-4">
        {['daily', 'weekly', 'monthly'].map((period) => (
          <div key={period}>
            <label className="mb-1 block text-sm capitalize text-content-secondary">
              {period} Budget (RMB)
            </label>
            <input
              type="number"
              value={(budget as any)[period]}
              onChange={(e) =>
                setBudget((p) => ({ ...p, [period]: parseFloat(e.target.value) || 0 }))
              }
              className="w-full rounded-sm border border-border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
          </div>
        ))}
        <button
          onClick={handleSave}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-content-inverse hover:bg-accent-hover"
        >
          Save Budget
        </button>
      </div>
    </div>
  );
}
