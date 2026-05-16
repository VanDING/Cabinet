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
  const [active, setActive] = useState<string>(() => localStorage.getItem('cabinet-active-api-key') ?? '');

  useEffect(() => {
    apiFetch('/api/settings/api-keys', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (d.keys) setKeys(d.keys); })
      .catch(() => {});
  }, []);

  const handleSelect = (key: ApiKey) => {
    setActive(key.id);
    localStorage.setItem('cabinet-active-api-key', key.id);
    if (key.model) localStorage.setItem('cabinet-selected-model', key.model);
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">API Switcher</div>
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {keys.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">No API keys configured.</div>
        ) : (
          keys.map(k => (
            <button
              key={k.id}
              onClick={() => handleSelect(k)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                active === k.id
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <div className="font-medium capitalize">{k.provider}</div>
              <div className="text-gray-400 text-xs">{k.keyPreview}{k.model ? ` · ${k.model}` : ''}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
