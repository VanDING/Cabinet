import { useState, useEffect } from 'react';

interface Project {
  id: string;
  name: string;
  sessions: { id: string; title: string }[];
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('cabinet-projects-sidebar');
      if (raw) setProjects(JSON.parse(raw));
    } catch {}
  }, []);

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Projects</div>
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {projects.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">No projects. Create in sidebar.</div>
        ) : (
          projects.map(p => (
            <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-xs">
              <div>
                <div className="font-medium text-gray-700 dark:text-gray-300">{p.name}</div>
                <div className="text-gray-400">{p.sessions.length} sessions</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
