import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';

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
      .catch((err) => { console.warn('Operation failed', err); });
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
        return 'border-intent-danger bg-intent-danger-muted';
      case 'T1':
        return 'border-intent-warning bg-intent-warning-muted';
      case 'T2':
        return 'border-accent bg-accent-muted';
      case 'T3':
        return 'border-intent-success bg-intent-success-muted';
      default:
        return 'border-border';
    }
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold text-content-primary">
        Delegation Tier
      </h2>
      <p className="mb-4 text-sm text-content-tertiary">
        Control how much autonomy Cabinet has before requiring your confirmation.
      </p>

      {/* Current tier description */}
      <div className={`mb-4 rounded-lg border border-border p-4 ${tierColor(tier)}`}>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-content-tertiary">{tier}</span>
          <span className="text-sm font-semibold text-content-primary">
            {tierLabel(tier)}
          </span>
        </div>
        <p className="text-xs text-content-secondary">{description}</p>
      </div>

      {/* Tier selector */}
      <div className="space-y-3">
        {available.map((t) => (
          <button
            key={t.id}
            onClick={() => handleChange(t.id)}
            disabled={loading || t.id === tier}
            className={`w-full rounded-lg border border-border p-3 text-left transition-all ${
              t.id === tier
                ? 'cursor-default border-accent ring-2 ring-accent'
                : 'cursor-pointer border-border hover:border-accent:border-accent'
            } ${loading ? 'opacity-50' : ''}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-content-tertiary">{t.id}</span>
              <span className="text-sm font-medium text-content-primary">
                {t.label}
              </span>
              {t.id === tier && (
                <span className="text-xs font-medium text-accent">Active</span>
              )}
            </div>
            <p className="text-xs text-content-tertiary">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Blocked tools info */}
      <div className="mt-4 rounded-lg border border-border bg-surface-elevated p-3">
        <p className="mb-1 text-xs font-medium text-content-secondary">
          What's blocked at {tierLabel(tier)}:
        </p>
        <ul className="list-inside list-disc space-y-0.5 text-xs text-content-tertiary">
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
