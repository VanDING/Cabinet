import { useState, useRef, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (file: { name: string; path: string }) => void;
}

const FALLBACK_FILES = [
  { name: 'main.tsx', path: 'apps/desktop/src/main.tsx' },
  { name: 'App.tsx', path: 'apps/desktop/src/App.tsx' },
  { name: 'navigation.tsx', path: 'packages/ui/src/navigation.tsx' },
  { name: 'secretary.ts', path: 'apps/server/src/routes/secretary.ts' },
  { name: 'agent-loop.ts', path: 'packages/agent/src/agent-loop.ts' },
  { name: 'ai-sdk-adapter.ts', path: 'packages/gateway/src/ai-sdk-adapter.ts' },
  { name: 'long-term.ts', path: 'packages/memory/src/long-term.ts' },
  { name: 'crypto.ts', path: 'apps/server/src/crypto.ts' },
  { name: 'settings.ts', path: 'apps/server/src/routes/settings.ts' },
  { name: 'tauri.conf.json', path: 'apps/desktop/src-tauri/tauri.conf.json' },
  { name: 'lib.rs', path: 'apps/desktop/src-tauri/src/lib.rs' },
  { name: 'package.json', path: 'package.json' },
  { name: 'TitleBar.tsx', path: 'apps/desktop/src/components/TitleBar.tsx' },
  { name: 'ChatPanel.tsx', path: 'apps/desktop/src/components/ChatPanel.tsx' },
  { name: 'useSessions.ts', path: 'apps/desktop/src/hooks/useSessions.ts' },
];

export function FileSearchPanel({ isOpen, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(FALLBACK_FILES);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setLoading(true);
      apiFetch('/api/files', { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (d.files?.length > 0) setResults(d.files);
        })
        .catch(() => setResults(FALLBACK_FILES))
        .finally(() => setLoading(false));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = query.trim()
    ? results.filter(
        (f) =>
          f.name.toLowerCase().includes(query.toLowerCase()) ||
          f.path.toLowerCase().includes(query.toLowerCase()),
      )
    : results.slice(0, 15);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20" onClick={onClose}>
      <div
        className="max-h-80 w-96 overflow-hidden rounded-lg border bg-surface-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b p-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search project files..."
            className="w-full rounded border bg-surface-elevated px-3 py-1.5 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-content-tertiary">Loading file tree...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-content-tertiary">No files found</div>
          ) : (
            filtered.map((f) => (
              <button
                key={f.path}
                onClick={() => {
                  onSelect(f);
                  onClose();
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-surface-muted bg-surface-input"
              >
                <span className="font-medium text-content-primary">{f.name}</span>
                <span className="ml-2 max-w-[200px] truncate text-xs text-content-tertiary">{f.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
