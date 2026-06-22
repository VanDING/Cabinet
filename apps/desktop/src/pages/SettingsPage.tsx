import { useState } from 'react';
import { Tabs, type Tab } from '@cabinet/ui';
import { RulesTab, OthersTab, ThemeTab } from './settings/index.js';

type SettingsTab = 'rules' | 'theme' | 'others';

const tabLabels: Record<SettingsTab, string> = {
  rules: 'Rules',
  theme: 'Theme',
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
      <h1 className="text-content-primary mb-6 text-2xl font-bold">Settings</h1>

      <Tabs
        tabs={tabItems}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as SettingsTab)}
        className="mb-6"
      />

      {/* Tab Content */}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'theme' && <ThemeTab />}
      {activeTab === 'others' && <OthersTab />}
    </div>
  );
}
