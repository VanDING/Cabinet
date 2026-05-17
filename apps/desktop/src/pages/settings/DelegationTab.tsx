import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

// ── Delegation Tab ──
export function DelegationTab() {
  const [tier, setTier] = useState('');
  const [available, setAvailable] = useState<{ id: string; label: string; description: string }[]>(
    [],
  );
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/delegation-tier', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
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
      const match = available.find((t) => t.id === newTier);
      if (match) setDescription(match.description);
    } catch {
      console.error('Failed to update delegation tier');
    }
    setLoading(false);
  };

  const tierLabel = (t: string) => {
    switch (t) {
      case 'T0':
        return 'Captain Review';
      case 'T1':
        return 'Strategic Guard';
      case 'T2':
        return 'Trusted Mode';
      case 'T3':
        return 'Full Autonomy';
      default:
        return t;
    }
  };

  const tierColor = (t: string) => {
    switch (t) {
      case 'T0':
        return 'border-red-400 bg-red-50 dark:bg-red-900/20';
      case 'T1':
        return 'border-amber-400 bg-amber-50 dark:bg-amber-900/20';
      case 'T2':
        return 'border-blue-400 bg-blue-50 dark:bg-blue-900/20';
      case 'T3':
        return 'border-green-400 bg-green-50 dark:bg-green-900/20';
      default:
        return 'border-gray-200 dark:border-gray-600';
    }
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Delegation Tier
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Control how much autonomy Cabinet has before requiring your confirmation.
      </p>

      {/* Current tier description */}
      <div className={`mb-4 rounded-lg border p-4 ${tierColor(tier)}`}>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-gray-500">{tier}</span>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {tierLabel(tier)}
          </span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      {/* Tier selector */}
      <div className="space-y-3">
        {available.map((t) => (
          <button
            key={t.id}
            onClick={() => handleChange(t.id)}
            disabled={loading || t.id === tier}
            className={`w-full rounded-lg border p-3 text-left transition-all ${
              t.id === tier
                ? 'cursor-default border-blue-500 ring-2 ring-blue-500'
                : 'cursor-pointer border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-700'
            } ${loading ? 'opacity-50' : ''}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-gray-500">{t.id}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {t.label}
              </span>
              {t.id === tier && (
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Active</span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Blocked tools info */}
      <div className="mt-4 rounded-lg border bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
        <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          What's blocked at {tierLabel(tier)}:
        </p>
        <ul className="list-inside list-disc space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
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
          {tier === 'T3' && <>Nothing is blocked. Budget cap is the only safety gate.</>}
        </ul>
      </div>
    </div>
  );
}
