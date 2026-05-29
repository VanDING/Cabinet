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
    <div className="flex h-full flex-col rounded-lg border bg-white p-4">
      <div className="mb-3 text-sm font-medium text-gray-700">API Switcher</div>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {keys.length === 0 ? (
          <div className="py-2 text-xs text-gray-400">No API keys configured.</div>
        ) : (
          keys.map((k) => (
            <button
              key={k.id}
              onClick={() => handleSelect(k)}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                active === k.id
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50:bg-gray-700'
              }`}
            >
              <div className="font-medium capitalize">{k.provider}</div>
              <div className="text-xs text-gray-400">
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
