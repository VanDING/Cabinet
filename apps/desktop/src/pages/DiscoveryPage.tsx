import { useState } from 'react';
import { Tabs, type Tab } from '@cabinet/ui';
import { SkillsTab, RulesTab, McpTab } from './settings/index.js';
import { AgentMarketContent } from './AgentMarketPage.js';
import { WorkbenchContent } from './WorkbenchPage.js';

type DiscoveryTab = 'rules' | 'skills' | 'mcp' | 'market' | 'workbench';

const tabLabels: Record<DiscoveryTab, string> = {
  rules: 'Rules',
  skills: 'Skills',
  mcp: 'MCP',
  market: 'Agent Market',
  workbench: 'Workbench',
};

export function DiscoveryPage() {
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('rules');

  const tabItems: Tab[] = (Object.keys(tabLabels) as DiscoveryTab[]).map((id) => ({
    id,
    label: tabLabels[id],
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-color)] px-6 pt-4">
        <h1 className="text-content-primary text-lg font-bold">Discovery</h1>
        <p className="text-content-tertiary mb-3 text-sm">
          Agent discovery, skills, MCP servers, and workbench.
        </p>
        <Tabs
          tabs={tabItems}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as DiscoveryTab)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'rules' && (
          <div className="p-6">
            <RulesTab />
          </div>
        )}
        {activeTab === 'skills' && (
          <div className="p-6">
            <SkillsTab />
          </div>
        )}
        {activeTab === 'mcp' && (
          <div className="p-6">
            <McpTab />
          </div>
        )}
        {activeTab === 'market' && <AgentMarketContent embedded />}
        {activeTab === 'workbench' && <WorkbenchContent embedded />}
      </div>
    </div>
  );
}
