import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { toast } from 'sonner';

export interface ProjectInfo {
  id: string;
  name: string;
  lastActivityAt?: string;
  activeWorkflowCount?: number;
  archived?: boolean;
  rootPath?: string;
}

interface ProjectContextValue {
  projects: ProjectInfo[];
  activeProjectId: string | null;
  refreshProjects: () => void;
  createProject: (name: string, rootPath?: string) => Promise<string | undefined>;
  deleteProject: (projectId: string, name: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  switchProject: (projectId: string | null) => void;
  showProjectActionModal: boolean;
  setShowProjectActionModal: (show: boolean) => void;
  handleCreateNewProject: () => Promise<void>;
  handleImportProject: () => Promise<void>;
  handleOpenProjectActionModal: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjectActionModal, setShowProjectActionModal] = useState(false);

  const refreshProjects = useCallback(() => {
    let retries = 0;
    const attempt = () => {
      apiFetch('/api/projects?archived=false', { headers: authHeaders() })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => setProjects(d.projects ?? []))
        .catch((err) => {
          if (retries < 3) {
            retries++;
            setTimeout(attempt, 1000 * retries);
          } else {
            console.warn('Failed to load projects after 3 retries', err);
          }
        });
    };
    attempt();
  }, []);

  const createProject = useCallback(
    async (name: string, rootPath = ''): Promise<string | undefined> => {
      const r = await apiFetch('/api/projects', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: name.trim(), rootPath }),
      });
      if (r.ok) {
        const data = await r.json();
        refreshProjects();
        return data.project?.id;
      }
      return undefined;
    },
    [refreshProjects],
  );

  const deleteProject = useCallback(
    async (projectId: string, _name: string) => {
      try {
        const r = await apiFetch(`/api/projects/${projectId}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (r.ok) {
          refreshProjects();
          if (projectId === activeProjectId) setActiveProjectId(null);
        }
      } catch {
        toast.error('Failed to delete project');
      }
    },
    [refreshProjects, activeProjectId],
  );

  const renameProject = useCallback(
    async (projectId: string, name: string) => {
      try {
        const r = await apiFetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: authJsonHeaders(),
          body: JSON.stringify({ name }),
        });
        if (r.ok) refreshProjects();
      } catch {
        toast.error('Failed to rename project');
      }
    },
    [refreshProjects],
  );

  const switchProject = useCallback((projectId: string | null) => {
    setActiveProjectId(projectId);
  }, []);

  const handleCreateNewProject = useCallback(async () => {
    const name = prompt('Project name:') || '';
    if (!name.trim()) return;
    try {
      const newProjectId = await createProject(name.trim());
      if (newProjectId) {
        setActiveProjectId(newProjectId);
      }
    } catch {
      toast.error('Failed to create project');
    }
  }, [createProject]);

  const handleImportProject = useCallback(async () => {
    let name = '';
    let rootPath = '';
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        title: 'Select project folder',
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        rootPath = selected;
        name = selected.split(/[/\\]/).pop() || selected;
      }
    } catch {
      /* Tauri dialog not available */
    }
    if (!name.trim()) return;
    try {
      const newProjectId = await createProject(name.trim(), rootPath);
      if (newProjectId) {
        setActiveProjectId(newProjectId);
      }
    } catch {
      toast.error('Failed to import project');
    }
  }, [createProject]);

  const handleOpenProjectActionModal = useCallback(() => {
    setShowProjectActionModal(true);
  }, []);

  // Initial load + listen for project deletion events from WebSocket broadcast
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const handler = (e: Event) => {
      refreshProjects();
      if ((e as CustomEvent).detail === activeProjectId) setActiveProjectId(null);
    };
    window.addEventListener('project_deleted', handler);
    return () => window.removeEventListener('project_deleted', handler);
  }, [refreshProjects, activeProjectId]);

  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      refreshProjects,
      createProject,
      deleteProject,
      renameProject,
      switchProject,
      showProjectActionModal,
      setShowProjectActionModal,
      handleCreateNewProject,
      handleImportProject,
      handleOpenProjectActionModal,
    }),
    [
      projects,
      activeProjectId,
      refreshProjects,
      createProject,
      deleteProject,
      renameProject,
      switchProject,
      showProjectActionModal,
      handleCreateNewProject,
      handleImportProject,
      handleOpenProjectActionModal,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
