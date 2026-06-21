import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext.js';

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, switchProject } = useProject();
  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  useEffect(() => {
    if (id) switchProject(id);
  }, [id, switchProject]);

  if (!project)
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-content-tertiary">Project not found.</p>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-content-primary mb-6 text-2xl font-bold">{project.name}</h1>
      <p className="text-content-tertiary mb-4 text-sm">
        Files and chat for this project are available via the sidebar and ChatView.
      </p>
      {project.lastActivityAt && (
        <p className="text-content-tertiary text-xs">
          Last activity: {new Date(project.lastActivityAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
