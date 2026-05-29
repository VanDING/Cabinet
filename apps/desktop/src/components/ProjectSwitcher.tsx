import { useState, useRef, useEffect } from 'react';
import type { ProjectItem } from '../hooks/useProject';

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
    draft: 'bg-amber-500',
    archived: 'bg-surface-muted',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border bg-surface-primary px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-elevated bg-surface-input"
      >
        <span
          className={`h-2 w-2 rounded-full ${current ? statusColors[current.status] : 'bg-surface-muted'}`}
        />
        <span className="font-medium">{current?.name ?? 'No project'}</span>
        <span className="text-content-tertiary">&#x25BE;</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border bg-surface-primary py-1 shadow-lg">
          <div className="px-3 py-2 text-xs uppercase text-content-tertiary">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onSwitch(p.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-elevated bg-surface-input ${
                p.id === current?.id
                  ? 'bg-accent-muted text-accent'
                  : 'text-content-secondary'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${statusColors[p.status]}`} />
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-content-tertiary">{p.description.slice(0, 40)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
