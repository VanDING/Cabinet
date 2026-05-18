import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SkillsTab,
  ApiKeysTab,
  RulesTab,
  McpTab,
  OthersTab,
  BudgetTab,
  DelegationTab,
  ThemeTab,
} from './settings/index.js';

type SettingsTab =
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'api-keys'
  | 'budget'
  | 'delegation'
  | 'theme'
  | 'others';

const tabKeys: Record<SettingsTab, string> = {
  'rules': 'rules',
  'skills': 'skills',
  'mcp': 'mcp',
  'api-keys': 'apiKeys',
  'budget': 'budget',
  'delegation': 'delegation',
  'theme': 'theme',
  'others': 'others',
};

const tabIcons: Record<SettingsTab, string> = {
  'rules': '\u{1F4DC}',
  'skills': '\u{1F9E9}',
  'mcp': '\u{1F527}',
  'api-keys': '\u{1F511}',
  'budget': '\u{1F4B0}',
  'delegation': '\u{1F6E1}',
  'theme': '\u{1F3A8}',
  'others': '\u{2699}',
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('rules');

  const tabs: { id: SettingsTab; label: string; icon: string }[] =
    Object.keys(tabKeys).map((id) => ({
      id: id as SettingsTab,
      label: t(`settings.tabs.${tabKeys[id as SettingsTab]}`),
      icon: tabIcons[id as SettingsTab],
    }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">{t('settings.title')}</h1>

      {/* Tab Bar */}
      <div className="mb-6 flex gap-1 border-b dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'rules' && <RulesTab />}
      {activeTab === 'skills' && <SkillsTab />}
      {activeTab === 'mcp' && <McpTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'budget' && <BudgetTab />}
      {activeTab === 'delegation' && <DelegationTab />}
      {activeTab === 'theme' && <ThemeTab />}
      {activeTab === 'others' && <OthersTab />}
    </div>
  );
}
