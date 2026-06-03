import { useState } from 'react';
import { Tabs, type Tab } from '@cabinet/ui';
import { ApiKeysTab, OthersTab, ThemeTab } from './settings/index.js';

type SettingsTab = 'api' | 'theme' | 'others';

const tabLabels: Record<SettingsTab, string> = {
  api: 'API Keys',
  theme: 'Theme',
  others: 'Others',
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('api');

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
      {activeTab === 'api' && <ApiKeysTab />}
      {activeTab === 'theme' && <ThemeTab />}
      {activeTab === 'others' && <OthersTab />}
    </div>
  );
}
