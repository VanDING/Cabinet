import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

interface ApiKey {
  id: string;
  provider: string;
  keyPreview: string;
  model?: string;
}

export function ApiSwitcher() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    const fetchKeys = () => {
      apiFetch('/api/settings/api-keys', { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (d.keys) setKeys(d.keys);
        })
        .catch(() => {});
    };
    fetchKeys();
    window.addEventListener('ws:apikeys_changed', fetchKeys);
    return () => window.removeEventListener('ws:apikeys_changed', fetchKeys);
  }, []);

  const handleSelect = async (key: ApiKey) => {
    setActive(key.id);
    if (key.model) localStorage.setItem('cabinet-selected-model', key.model);
    try {
      await apiFetch('/api/settings/preferred-key', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ keyId: key.id }),
      });
    } catch {
      // Preference stored server-side, network error is non-fatal
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium text-content-secondary">API Switcher</div>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {keys.length === 0 ? (
          <div className="py-2 text-xs text-content-tertiary">No API keys configured.</div>
        ) : (
          keys.map((k) => (
            <button
              key={k.id}
              onClick={() => handleSelect(k)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                active === k.id
                  ? 'bg-accent-muted text-accent'
                  : 'text-content-secondary hover:bg-surface-elevated bg-surface-input'
              }`}
            >
              <div className="font-medium capitalize">{k.provider}</div>
              <div className="text-xs text-content-tertiary">
                {k.keyPreview}
                {k.model ? ` · ${k.model}` : ''}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
