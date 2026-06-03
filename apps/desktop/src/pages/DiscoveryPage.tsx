import { useState } from 'react';
import { Tabs, type Tab } from '@cabinet/ui';
import { SkillsTab, RulesTab, McpTab } from './settings/index.js';

type DiscoveryTab = 'rules' | 'skills' | 'mcp';

const tabLabels: Record<DiscoveryTab, string> = {
  rules: 'Rules',
  skills: 'Skills',
  mcp: 'MCP',
};

export function DiscoveryPage() {
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('rules');

  const tabItems: Tab[] = (Object.keys(tabLabels) as DiscoveryTab[]).map((id) => ({
    id,
    label: tabLabels[id],
  }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-content-primary">
        Discovery
      </h1>

      <Tabs
        tabs={tabItems}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as DiscoveryTab)}
        className="mb-6"
      />

      {/* Tab Content */}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'skills' && <SkillsTab />}
      {activeTab === 'mcp' && <McpTab />}
    </div>
  );
}
