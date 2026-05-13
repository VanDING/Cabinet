import { useState, useCallback, useEffect } from 'react';

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'draft' | 'archived';
}

const DEMO_PROJECTS: ProjectItem[] = [
  { id: 'proj-1', name: 'Product Launch Q3', description: 'Enter maternal-infant market', status: 'active' },
  { id: 'proj-2', name: 'Cost Optimization', description: 'Reduce operational expenses by 20%', status: 'active' },
  { id: 'proj-3', name: 'Brand Redesign', description: 'New visual identity and website', status: 'draft' },
];

export function useProject() {
  const [projects] = useState<ProjectItem[]>(DEMO_PROJECTS);
  const [currentId, setCurrentId] = useState<string>(() => {
    return localStorage.getItem('cabinet-project') ?? 'proj-1';
  });

  useEffect(() => {
    localStorage.setItem('cabinet-project', currentId);
  }, [currentId]);

  const current = projects.find(p => p.id === currentId) ?? projects[0]!;

  return {
    projects,
    current,
    currentId,
    setProject: useCallback((id: string) => setCurrentId(id), []),
  };
}
