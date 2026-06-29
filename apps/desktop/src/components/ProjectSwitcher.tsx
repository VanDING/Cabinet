import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProjectItem {
  id: string;
  name: string;
  status: string;
  description: string;
}

interface Props {
  projects: ProjectItem[];
  current: ProjectItem | null;
  onSwitch: (id: string | null) => void;
}

export function ProjectSwitcher({ projects, current, onSwitch }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="border-border bg-surface-primary text-content-secondary hover:bg-surface-elevated bg-surface-input flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors">
        <span className={`h-2 w-2 rounded-full ${current === null ? 'bg-surface-muted' : ''}`} />
        <span className="font-medium">{current?.name ?? 'No project'}</span>
        <span className="text-content-tertiary">&#x25BE;</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => onSwitch(p.id)}
            className={p.id === current?.id ? 'bg-accent-muted text-accent' : ''}
          >
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-muted-foreground text-xs">{p.description.slice(0, 40)}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
