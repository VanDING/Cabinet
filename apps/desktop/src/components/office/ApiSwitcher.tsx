import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface ApiKey {
  id: string;
  provider: string;
  keyPreview: string;
  model?: string;
}

export function ApiSwitcher() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [active, setActive] = useState<string>(
    () => localStorage.getItem('cabinet-active-api-key') ?? '',
  );

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

  const handleSelect = (key: ApiKey) => {
    setActive(key.id);
    localStorage.setItem('cabinet-active-api-key', key.id);
    if (key.model) localStorage.setItem('cabinet-selected-model', key.model);
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
