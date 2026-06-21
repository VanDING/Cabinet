import type { NavPage } from '@cabinet/ui';

const navLabels = ['Office', 'Workflows', 'Staff', 'Memory', 'Workbench'];
const navIds: NavPage[] = ['office', 'workflows', 'employees', 'memory', 'workbench'];

interface Props {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
}

export function MobileNav({ activePage, onNavigate }: Props) {
  const items = navIds.map((id, i) => ({
    id,
    label: navLabels[i],
  }));

  return (
    <nav
      aria-label="Mobile navigation"
      className="border-border bg-surface-primary text-content-primary fixed right-0 bottom-0 left-0 z-50 border-t md:hidden"
    >
      <div className="flex justify-around py-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
            aria-current={activePage === item.id ? 'page' : undefined}
            className={`flex flex-col items-center px-2 py-1.5 text-xs transition-colors ${
              activePage === item.id ? 'text-accent' : 'text-content-tertiary'
            }`}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
