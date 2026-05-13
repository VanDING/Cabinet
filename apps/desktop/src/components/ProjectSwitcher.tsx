import React, { useState, useRef, useEffect } from 'react';
import type { ProjectItem } from '../hooks/useProject';

interface Props {
  projects: ProjectItem[];
  current: ProjectItem;
  onSwitch: (id: string) => void;
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
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        <span className={`w-2 h-2 rounded-full ${statusColors[current.status]}`} />
        <span className="font-medium">{current.name}</span>
        <span className="text-gray-400">&#x25BE;</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-64 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 shadow-lg z-50 py-1">
          <div className="px-3 py-2 text-xs text-gray-400 uppercase">Projects</div>
          {projects.map(p => (
            <button key={p.id} onClick={() => { onSwitch(p.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                p.id === current.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'
              }`}>
              <span className={`w-2 h-2 rounded-full ${statusColors[p.status]}`} />
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
