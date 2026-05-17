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
    } catch {
      /* localStorage parse error */
    }
  }, []);

  return (
    <div className="flex h-full flex-col rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Projects</div>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="py-2 text-xs text-gray-400">No projects. Create in sidebar.</div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
            >
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
