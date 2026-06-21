import { useState } from 'react';
import { ApiKeysTab } from './ApiKeysTab.js';
import { McpTab } from './McpTab.js';
import { SkillsTab } from './SkillsTab.js';
import { AgentsTab } from './AgentsTab.js';

type WorkbenchTab = 'agents' | 'apikeys' | 'mcp' | 'skills';

const tabs: { id: WorkbenchTab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'apikeys', label: 'API Keys' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'skills', label: 'Skills' },
];

export function WorkbenchPage() {
  const [tab, setTab] = useState<WorkbenchTab>('agents');
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-content-primary mb-6 text-2xl font-bold">Workbench</h1>

      <div className="mb-6 flex gap-1 border-b border-[var(--border-color)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'text-content-tertiary hover:text-content-secondary border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'agents' && <AgentsTab />}
      {tab === 'apikeys' && <ApiKeysTab />}
      {tab === 'mcp' && <McpTab />}
      {tab === 'skills' && <SkillsTab />}
    </div>
  );
}
