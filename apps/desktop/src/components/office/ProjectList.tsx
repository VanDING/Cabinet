import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Project {
  id: string;
  name: string;
  workflowCount?: number;
  lastActivityAt?: string;
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);

  const fetchProjects = useCallback(() => {
    apiFetch('/api/projects?archived=false', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch((err) => { console.warn('Operation failed', err); });
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    window.addEventListener('ws:project_created', fetchProjects);
    window.addEventListener('ws:project_updated', fetchProjects);
    window.addEventListener('ws:project_deleted', fetchProjects);
    return () => {
      window.removeEventListener('ws:project_created', fetchProjects);
      window.removeEventListener('ws:project_updated', fetchProjects);
      window.removeEventListener('ws:project_deleted', fetchProjects);
    };
  }, [fetchProjects]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
      <div className="mb-3 text-sm font-medium text-content-secondary">Projects</div>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="py-2 text-xs text-content-tertiary">No projects. Create in sidebar.</div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-sm px-2 py-1.5 text-xs bg-surface-input hover:bg-surface-elevated"
            >
              <div>
                <div className="font-medium text-content-secondary">{p.name}</div>
                {(p.workflowCount ?? 0) > 0 && (
                  <div className="text-content-tertiary">{p.workflowCount} workflows</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
