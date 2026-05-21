import { useState, useCallback, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'draft' | 'archived';
}

export function useProject() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    return localStorage.getItem('cabinet-project') || null;
  });

  useEffect(() => {
    apiFetch('/api/projects?archived=false', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.projects ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
          status: (p.archived ? 'archived' : 'active') as ProjectItem['status'],
        }));
        setProjects(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentId) {
      localStorage.setItem('cabinet-project', currentId);
    } else {
      localStorage.removeItem('cabinet-project');
    }
  }, [currentId]);

  const current = projects.find((p) => p.id === currentId) ?? projects[0] ?? null;

  return {
    projects,
    current,
    currentId,
    setProject: useCallback((id: string | null) => setCurrentId(id), []),
  };
}
