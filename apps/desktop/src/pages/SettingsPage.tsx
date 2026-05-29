import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, type Tab } from '@cabinet/ui';
import { SkillsTab, ApiKeysTab, RulesTab, McpTab, OthersTab } from './settings/index.js';

type SettingsTab = 'rules' | 'skills' | 'mcp' | 'api' | 'others';

const tabKeys: Record<SettingsTab, string> = {
  rules: 'rules',
  skills: 'skills',
  mcp: 'mcp',
  api: 'apiKeys',
  others: 'others',
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('rules');

  const tabItems: Tab[] = (Object.keys(tabKeys) as SettingsTab[]).map((id) => ({
    id,
    label: t(`settings.tabs.${tabKeys[id]}`),
  }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-content-primary">
        {t('settings.title')}
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
