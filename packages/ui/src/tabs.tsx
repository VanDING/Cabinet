import { Tabs as ShadcnTabs, TabsList, TabsTrigger } from
  '../../../apps/desktop/src/components/ui/tabs.js';
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
    <ShadcnTabs value={activeTab} onValueChange={onTabChange} className={cn('border-border border-b', className)}>
      <TabsList className="h-auto gap-4 border-0 bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="border-b-2 pb-2 text-sm font-medium capitalize transition-colors
                       data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)]
                       data-[state=inactive]:border-transparent data-[state=inactive]:text-[var(--content-tertiary)]
                       data-[state=inactive]:hover:text-[var(--content-secondary)]
                       rounded-none bg-transparent px-0 shadow-none"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadcnTabs>
  );
}
