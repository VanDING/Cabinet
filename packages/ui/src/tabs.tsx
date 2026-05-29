import { cn } from './cn.js';

export interface Tab {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('flex gap-4 border-b border-border', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'border-b-2 pb-2 text-sm font-medium capitalize transition-colors',
            activeTab === tab.id
              ? 'border-accent text-accent'
              : 'border-transparent text-content-tertiary hover:text-content-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
