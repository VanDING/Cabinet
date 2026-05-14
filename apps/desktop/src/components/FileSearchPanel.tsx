import { useState, useRef, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (file: { name: string; path: string }) => void;
}

// Simulated project file tree — in production this would scan the actual workspace
function searchProjectFiles(query: string): { name: string; path: string }[] {
  const fileTree = [
    { name: 'main.tsx', path: 'apps/desktop/src/main.tsx' },
    { name: 'App.tsx', path: 'apps/desktop/src/App.tsx' },
    { name: 'navigation.tsx', path: 'packages/ui/src/navigation.tsx' },
    { name: 'secretary.ts', path: 'apps/server/src/routes/secretary.ts' },
    { name: 'agent-loop.ts', path: 'packages/agent/src/agent-loop.ts' },
    { name: 'ai-sdk-adapter.ts', path: 'packages/gateway/src/ai-sdk-adapter.ts' },
    { name: 'llm-gateway.ts', path: 'packages/gateway/src/llm-gateway.ts' },
    { name: 'long-term.ts', path: 'packages/memory/src/long-term.ts' },
    { name: 'crypto.ts', path: 'apps/server/src/crypto.ts' },
    { name: 'backup.ts', path: 'packages/storage/src/backup.ts' },
    { name: 'settings.ts', path: 'apps/server/src/routes/settings.ts' },
    { name: 'index.ts', path: 'packages/gateway/src/index.ts' },
    { name: 'index.ts', path: 'packages/agent/src/index.ts' },
    { name: 'index.ts', path: 'packages/memory/src/index.ts' },
    { name: 'index.ts', path: 'packages/storage/src/index.ts' },
    { name: 'index.ts', path: 'packages/events/src/index.ts' },
    { name: 'tauri.conf.json', path: 'apps/desktop/src-tauri/tauri.conf.json' },
    { name: 'Cargo.toml', path: 'apps/desktop/src-tauri/Cargo.toml' },
    { name: 'lib.rs', path: 'apps/desktop/src-tauri/src/lib.rs' },
    { name: 'package.json', path: 'package.json' },
    { name: 'useSessions.ts', path: 'apps/desktop/src/hooks/useSessions.ts' },
    { name: 'useTheme.ts', path: 'apps/desktop/src/hooks/useTheme.ts' },
    { name: 'useProject.ts', path: 'apps/desktop/src/hooks/useProject.ts' },
    { name: 'SecretaryChat.tsx', path: 'packages/ui/src/secretary-chat.tsx' },
    { name: 'DecisionCard.tsx', path: 'packages/ui/src/decision-card.tsx' },
    { name: 'TitleBar.tsx', path: 'apps/desktop/src/components/TitleBar.tsx' },
    { name: 'ChatPanel.tsx', path: 'apps/desktop/src/components/ChatPanel.tsx' },
    { name: 'Toast.tsx', path: 'apps/desktop/src/components/Toast.tsx' },
    { name: 'MobileNav.tsx', path: 'apps/desktop/src/components/MobileNav.tsx' },
    { name: 'ProjectSwitcher.tsx', path: 'apps/desktop/src/components/ProjectSwitcher.tsx' },
  ];

  if (!query.trim()) return fileTree.slice(0, 15);
  const q = query.toLowerCase();
  return fileTree.filter(f =>
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  );
}

export function FileSearchPanel({ isOpen, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const results = searchProjectFiles(query);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20" onClick={onClose}>
      <div
        className="w-96 max-h-80 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-3 border-b dark:border-gray-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search project files..."
            className="w-full border dark:border-gray-600 rounded px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-y-auto max-h-60">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No files found</div>
          ) : (
            results.map(f => (
              <button
                key={f.path}
                onClick={() => { onSelect(f); onClose(); }}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex items-center justify-between"
              >
                <span className="text-gray-800 dark:text-gray-200 font-medium">{f.name}</span>
                <span className="text-xs text-gray-400 ml-2 truncate max-w-[200px]">{f.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
