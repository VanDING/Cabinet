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
    active: 'bg-green-500',
    draft: 'bg-amber-500',
    archived: 'bg-gray-400',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50:bg-gray-700"
      >
        <span
          className={`h-2 w-2 rounded-full ${current ? statusColors[current.status] : 'bg-gray-400'}`}
        />
        <span className="font-medium">{current?.name ?? 'No project'}</span>
        <span className="text-gray-400">&#x25BE;</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border bg-white py-1 shadow-lg">
          <div className="px-3 py-2 text-xs uppercase text-gray-400">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onSwitch(p.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50:bg-gray-700 ${
                p.id === current?.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${statusColors[p.status]}`} />
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-400">{p.description.slice(0, 40)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
