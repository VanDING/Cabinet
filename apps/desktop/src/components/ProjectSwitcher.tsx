import { useState, useRef, useEffect } from 'react';

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const statusColors: Record<string, string> = {
    active: 'bg-intent-success',
    draft: 'bg-intent-warning',
    archived: 'bg-surface-muted',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="border-border bg-surface-primary text-content-secondary hover:bg-surface-elevated bg-surface-input flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
      >
        <span
          className={`h-2 w-2 rounded-full ${current ? statusColors[current.status] : 'bg-surface-muted'}`}
        />
        <span className="font-medium">{current?.name ?? 'No project'}</span>
        <span className="text-content-tertiary">&#x25BE;</span>
      </button>

      {open && (
        <div className="border-border bg-surface-primary absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border py-1 shadow-lg">
          <div className="text-content-tertiary px-3 py-2 text-xs uppercase">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onSwitch(p.id);
                setOpen(false);
              }}
              className={`hover:bg-surface-elevated bg-surface-input flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                p.id === current?.id ? 'bg-accent-muted text-accent' : 'text-content-secondary'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${statusColors[p.status]}`} />
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-content-tertiary text-xs">{p.description.slice(0, 40)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
