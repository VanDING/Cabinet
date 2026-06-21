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
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-color)] px-6 pt-4">
        <h1 className="text-content-primary text-lg font-bold">Workbench</h1>
        <p className="text-content-tertiary mb-3 text-sm">
          Unified management for agents, API keys, MCP servers, and skills.
        </p>
        <div className="flex gap-1">
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
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'agents' && <AgentsTab />}
        {tab === 'apikeys' && <ApiKeysTab />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'skills' && <SkillsTab />}
      </div>
    </div>
  );
}
