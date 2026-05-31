import { useState } from 'react';
import { Tabs, type Tab } from '@cabinet/ui';
import { SkillsTab, ApiKeysTab, RulesTab, McpTab, OthersTab } from './settings/index.js';

type SettingsTab = 'rules' | 'skills' | 'mcp' | 'api' | 'others';

const tabLabels: Record<SettingsTab, string> = {
  rules: 'Rules',
  skills: 'Skills',
  mcp: 'MCP',
  api: 'API Keys',
  others: 'Others',
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('rules');

  const tabItems: Tab[] = (Object.keys(tabLabels) as SettingsTab[]).map((id) => ({
    id,
    label: tabLabels[id],
  }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-content-primary">
        Settings
      </h1>

      <Tabs
        tabs={tabItems}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as SettingsTab)}
        className="mb-6"
      />

      {/* Tab Content */}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'skills' && <SkillsTab />}
      {activeTab === 'mcp' && <McpTab />}
      {activeTab === 'api' && <ApiKeysTab />}
      {activeTab === 'others' && <OthersTab />}
    </div>
  );
}
