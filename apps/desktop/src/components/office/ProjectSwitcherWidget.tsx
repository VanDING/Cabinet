import { useProject } from '../../hooks/useProject';
import { ProjectSwitcher } from '../ProjectSwitcher';

export function ProjectSwitcherWidget() {
  const { projects, current, setProject } = useProject();

  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-surface-primary p-4">
      <h3 className="mb-3 text-sm font-semibold text-content-primary">
        Active Project
      </h3>
      <ProjectSwitcher projects={projects} current={current} onSwitch={setProject} />
      {current && <span className="mt-2 text-xs text-content-tertiary">Project ID: {current.id}</span>}
    </div>
  );
}
